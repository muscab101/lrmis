-- A citizen can pay several bills in one go (for example the yearly tax and the registration bills), choosing
-- which ones. One online payment is made for the total; when it arrives, each chosen bill gets its own payment and
-- receipt (bills can be on different properties). Also: online money for land not registered yet now pays its bills
-- (partial land registers by itself once paid, see 0229) instead of waiting in Unmatched.

alter table public.payment_intents add column if not exists items jsonb;
comment on column public.payment_intents.items is 'Several bills paid together: [{invoice_id, amount}] (null: just invoice_id).';

/** Start one online payment for several of the caller's bills. */
create or replace function public.payment_intent_create_many(p_invoices uuid[], p_provider text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := (select array_agg(distinct x) from unnest(p_invoices) x where x is not null);
  v_prov public.payment_providers;
  r record;
  v_amt numeric;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_currency text;
  v_numbers text[] := '{}';
  v_puns text[] := '{}';
  v_first uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    perform private.raise_app_error('PERMISSION_DENIED');
  end if;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 20 then
    perform private.raise_app_error('VALIDATION', 'invoices');
  end if;
  for r in
    select i.*, p.pun, p.building_state
      from public.invoices i left join public.parcels p on p.id = i.parcel_id
     where i.id = any (v_ids)
     order by i.due_date, i.issue_date, i.number
  loop
    if not (private.is_parcel_owner(r.parcel_id) or (public.has_permission('payments.create') and public.can_access_district(r.district_id))) then
      perform private.raise_app_error('NOT_FOUND', 'invoice');
    end if;
    if r.status not in ('issued', 'partially_paid') or r.balance <= 0 then
      perform private.raise_app_error('NOT_FOUND', 'invoice');
    end if;
    if r.building_state = 'demolished' then
      perform private.raise_app_error('CONFLICT', 'parcel_demolished');
    end if;
    if v_currency is not null and v_currency <> r.currency then
      perform private.raise_app_error('VALIDATION', 'currency');
    end if;
    v_currency := r.currency;
    -- The discounted balance while the early-payment window is open.
    v_amt := r.balance;
    if r.discount_until is not null and r.discount_until >= current_date and r.paid = 0 and r.early_discount_pct > 0 then
      v_amt := r.balance - round(r.balance * r.early_discount_pct / 100, 2);
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('invoice_id', r.id, 'amount', v_amt));
    v_total := v_total + v_amt;
    v_numbers := v_numbers || r.number;
    if r.pun is not null and not (r.pun = any (v_puns)) then
      v_puns := v_puns || r.pun;
    end if;
    v_first := coalesce(v_first, r.id);
  end loop;
  if jsonb_array_length(v_items) <> cardinality(v_ids) then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  select * into v_prov from public.payment_providers where code = p_provider and enabled and method in ('mobile_money', 'card');
  if v_prov.code is null then
    perform private.raise_app_error('VALIDATION', 'provider');
  end if;
  if v_prov.method = 'mobile_money' and coalesce(p_phone, '') !~ '^\+?252[0-9]{8,9}$' then
    perform private.raise_app_error('VALIDATION', 'phone');
  end if;
  if (select count(*) from public.payment_intents where created_by = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    perform private.raise_app_error('RATE_LIMITED');
  end if;
  insert into public.payment_intents (invoice_id, provider, amount, currency, phone, created_by, expires_at, items)
  values (v_first, p_provider, v_total, v_currency, nullif(p_phone, ''), auth.uid(),
          now() + make_interval(mins => private.setting_int('payments.intent_ttl_minutes', 30)),
          case when jsonb_array_length(v_items) > 1 then v_items end)
  returning id into v_id;
  return jsonb_build_object('intent_id', v_id, 'amount', v_total, 'currency', v_currency,
                            'invoice_number', array_to_string(v_numbers, ', '),
                            'pun', case when cardinality(v_puns) = 1 then v_puns[1] end);
end;
$$;
revoke all on function public.payment_intent_create_many(uuid[], text, text) from public, anon;
grant execute on function public.payment_intent_create_many(uuid[], text, text) to authenticated;

-- When the money for several bills arrives: one payment (and receipt) per bill, each on its own land.
do $$
declare
  d text := pg_get_functiondef('public.webhook_ingest(text,text,boolean,jsonb,jsonb)'::regprocedure);
  a1 text := '  v_method public.payment_method;
begin';
  b1 text := '  v_method public.payment_method;
  v_item jsonb;
  v_n int := 0;
  v_first jsonb;
begin';
  a2 text := '  if v_intent.id is not null then
    select * into v_inv from public.invoices where id = v_intent.invoice_id;';
  b2 text := '  if v_intent.id is not null and jsonb_array_length(coalesce(v_intent.items, ''[]''::jsonb)) > 1
     and (p_event ->> ''amount'')::numeric = v_intent.amount then
    for v_item in select * from jsonb_array_elements(v_intent.items) loop
      v_n := v_n + 1;
      select * into v_inv from public.invoices where id = (v_item ->> ''invoice_id'')::uuid;
      v_parcel := v_inv.parcel_id;
      if exists (select 1 from public.parcels p where p.id = v_parcel and p.building_state = ''demolished'') then
        v_parcel := null;
        v_inv := null;
      end if;
      v_res := private.record_payment(jsonb_build_object(
        ''parcel_id'', v_parcel, ''invoice_id'', v_inv.id, ''method'', coalesce(v_method, ''mobile_money''), ''provider'', p_provider,
        ''provider_ref'', coalesce(p_event ->> ''provider_ref'', p_event_id) || case when v_n > 1 then ''#'' || v_n else '''' end,
        ''reference'', case when v_n = 1 then p_event ->> ''reference'' end,
        ''currency'', coalesce(p_event ->> ''currency'', ''USD''), ''amount'', (v_item ->> ''amount'')::numeric,
        ''intent_id'', v_intent.id, ''payer_phone'', p_event ->> ''phone''));
      v_first := coalesce(v_first, v_res);
    end loop;
    update public.payment_intents set status = ''succeeded'', completed_at = now() where id = v_intent.id;
    update public.provider_webhook_events set processed_at = now(), result = ''recorded'', payment_id = (v_first ->> ''payment_id'')::uuid where id = v_ev;
    return jsonb_build_object(''result'', ''recorded'', ''payments'', v_n) || v_first;
  end if;

' || a2;
  a3 text := 'p.status in (''draft'', ''surveyed'', ''verified'') or p.building_state = ''demolished''';
  b3 text := 'p.building_state = ''demolished''';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'webhook_ingest: anchors not found';
  end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

-- The receipt shown after paying: the first one of the payment.
create or replace function public.payment_intent_status(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', case when pi.status = 'pending' and pi.expires_at < now() then 'expired' else pi.status::text end,
                            'receipt_no', (select string_agg(receipt_no, ', ' order by created_at, receipt_no) from public.payments where intent_id = pi.id),
                            'failure_reason', pi.failure_reason)
  from public.payment_intents pi where pi.id = p_id;
$$;
