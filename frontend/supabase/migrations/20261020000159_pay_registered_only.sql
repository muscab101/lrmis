-- A bill can only be paid once its parcel is registered. Bills of land still in partial registration wait.
-- Paying goes through a payment on the parcel, so that is where it is stopped: the desk, matching and every other way in.
create or replace function private.payment_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parcel_id is null then
    return new;
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.layout <> 'house') then
    perform private.raise_app_error('CONFLICT', 'land_has_units');
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.status in ('draft', 'surveyed', 'verified')) then
    perform private.raise_app_error('CONFLICT', 'bill_needs_registered');
  end if;
  return new;
end;
$$;

create or replace function public.payment_intent_create(p_invoice uuid, p_token text, p_provider text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_prov public.payment_providers;
  v_id uuid;
  v_amount numeric;
begin
  if p_token is not null then
    select i.* into v_inv from public.invoice_tokens t join public.invoices i on i.id = t.invoice_id where t.token = p_token;
  else
    select * into v_inv from public.invoices where id = p_invoice
      and (private.is_parcel_owner(parcel_id) or (public.has_permission('payments.create') and public.can_access_district(district_id)));
  end if;
  if v_inv.id is null or v_inv.status not in ('issued', 'partially_paid') or v_inv.balance <= 0 then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  if exists (select 1 from public.parcels p where p.id = v_inv.parcel_id and p.status in ('draft', 'surveyed', 'verified')) then
    perform private.raise_app_error('CONFLICT', 'bill_needs_registered');
  end if;
  select * into v_prov from public.payment_providers where code = p_provider and enabled and method in ('mobile_money', 'card');
  if v_prov.code is null then
    perform private.raise_app_error('VALIDATION', 'provider');
  end if;
  if v_prov.method = 'mobile_money' and coalesce(p_phone, '') !~ '^\+?252[0-9]{8,9}$' then
    perform private.raise_app_error('VALIDATION', 'phone');
  end if;
  if (select count(*) from public.payment_intents where invoice_id = v_inv.id and created_at > now() - interval '10 minutes') >= 5 then
    perform private.raise_app_error('RATE_LIMITED');
  end if;
  -- Pay the discounted balance if the early-payment window is open.
  v_amount := v_inv.balance;
  if v_inv.discount_until is not null and v_inv.discount_until >= current_date and v_inv.paid = 0 and v_inv.early_discount_pct > 0 then
    v_amount := v_inv.balance - round(v_inv.balance * v_inv.early_discount_pct / 100, 2);
  end if;
  insert into public.payment_intents (invoice_id, provider, amount, currency, phone, created_by, expires_at)
  values (v_inv.id, p_provider, v_amount, v_inv.currency, nullif(p_phone, ''), auth.uid(),
          now() + make_interval(mins => private.setting_int('payments.intent_ttl_minutes', 30)))
  returning id into v_id;
  return jsonb_build_object('intent_id', v_id, 'amount', v_amount, 'currency', v_inv.currency, 'invoice_number', v_inv.number,
                            'pun', (select pun from public.parcels where id = v_inv.parcel_id));
end;
$$;

create or replace function public.webhook_ingest(p_provider text, p_event_id text, p_signature_ok boolean, p_event jsonb, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev bigint;
  v_intent public.payment_intents;
  v_inv public.invoices;
  v_parcel uuid;
  v_res jsonb;
  v_result text;
  v_method public.payment_method;
begin
  -- Forged events are kept for audit but never claim the event id, so they can't block the real one.
  if not p_signature_ok then
    insert into public.provider_webhook_events (provider, event_id, raw, signature_ok, processed_at, result)
    values (p_provider, p_event_id, coalesce(p_raw, '{}'::jsonb), false, now(), 'bad_signature');
    return jsonb_build_object('result', 'bad_signature');
  end if;
  insert into public.provider_webhook_events (provider, event_id, raw, signature_ok)
  values (p_provider, p_event_id, coalesce(p_raw, '{}'::jsonb), true)
  on conflict (provider, event_id) where signature_ok do nothing
  returning id into v_ev;
  if v_ev is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select method into v_method from public.payment_providers where code = p_provider;

  select * into v_intent from public.payment_intents
  where id = nullif(p_event ->> 'intent_id', '')::uuid or (provider_ref is not null and provider_ref = p_event ->> 'provider_ref')
  limit 1 for update;

  if p_event ->> 'status' <> 'succeeded' then
    if v_intent.id is not null and v_intent.status = 'pending' then
      update public.payment_intents set status = 'failed', failure_reason = left(coalesce(p_event ->> 'failure_reason', 'failed'), 200), completed_at = now()
       where id = v_intent.id;
    end if;
    update public.provider_webhook_events set processed_at = now(), result = 'failed' where id = v_ev;
    return jsonb_build_object('result', 'failed');
  end if;

  if exists (select 1 from public.payments where provider_ref = coalesce(p_event ->> 'provider_ref', p_event_id)) then
    update public.provider_webhook_events set processed_at = now(), result = 'already_recorded' where id = v_ev;
    return jsonb_build_object('result', 'already_recorded');
  end if;

  if v_intent.id is not null then
    select * into v_inv from public.invoices where id = v_intent.invoice_id;
    v_parcel := v_inv.parcel_id;
    v_result := 'recorded';
  else
    -- Merchant-number / USSD payments carry the PUN as the reference.
    select id into v_parcel from public.parcels where pun = upper(trim(p_event ->> 'reference')) and deleted_at is null;
    v_result := case when v_parcel is null then 'unmatched' else 'recorded_by_reference' end;
  end if;

  -- Money that arrives for land not registered yet is kept, waiting in the matching queue with nothing paid.
  if exists (select 1 from public.parcels p where p.id = v_parcel and p.status in ('draft', 'surveyed', 'verified')) then
    v_parcel := null;
    v_inv := null;
    v_result := 'unmatched';
  end if;

  v_res := private.record_payment(jsonb_build_object(
    'parcel_id', v_parcel, 'invoice_id', v_inv.id, 'method', coalesce(v_method, 'mobile_money'), 'provider', p_provider,
    'provider_ref', coalesce(p_event ->> 'provider_ref', p_event_id), 'reference', p_event ->> 'reference',
    'currency', coalesce(p_event ->> 'currency', 'USD'), 'amount', (p_event ->> 'amount')::numeric,
    'intent_id', v_intent.id, 'payer_phone', p_event ->> 'phone'));
  if v_intent.id is not null then
    update public.payment_intents set status = 'succeeded', completed_at = now() where id = v_intent.id;
  end if;
  update public.provider_webhook_events set processed_at = now(), result = v_result, payment_id = (v_res ->> 'payment_id')::uuid where id = v_ev;
  return jsonb_build_object('result', v_result) || v_res;
end;
$$;

/** The Invoices page's two lists: how many bills, and what is still owed, for registered land and for land in partial registration. */
create function public.invoices_by_land()
returns table (partial boolean, invoices bigint, owed numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.status in ('draft', 'surveyed', 'verified'), count(*),
         coalesce(sum(i.balance) filter (where i.status in ('issued', 'partially_paid')), 0)
    from public.invoices i
    join public.parcels p on p.id = i.parcel_id
   where i.status <> 'cancelled'
   group by 1;
$$;
revoke all on function public.invoices_by_land() from public, anon;
grant execute on function public.invoices_by_land() to authenticated;

-- The pay page opened from an invoice's QR code says when the land isn't registered yet.
create or replace function public.invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('number', i.number, 'pun', p.pun, 'period', i.period, 'fee', f.name_en, 'fee_so', f.name_so,
                            'due_date', i.due_date, 'total', i.total, 'paid', i.paid + i.credited, 'balance', i.balance,
                            'status', i.status, 'currency', i.currency, 'partial', p.status in ('draft', 'surveyed', 'verified'))
  from public.invoice_tokens t join public.invoices i on i.id = t.invoice_id
  join public.parcels p on p.id = i.parcel_id join public.fee_types f on f.id = i.fee_type_id
  where t.token = p_token and length(p_token) = 64 and i.status <> 'cancelled';
$$;
