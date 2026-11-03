-- Demolished land is an archive: it can be seen, and nothing else. No payment, transfer, division, bill, edit, lock or
-- certificate, whoever asks and however. It leaves the archive only through Undo or Register again on the Demolished page.
-- Its unpaid bills stay as they are, frozen, as a record. Land that is registered again can be paid as normal.

create function private.parcel_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcel uuid := case when tg_op = 'DELETE' then old.parcel_id else new.parcel_id end;
begin
  if exists (select 1 from public.parcels p where p.id = v_parcel and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.parcel_archive_guard() from public, anon, authenticated;
create trigger archive_guard before insert on public.appeals for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.assessments for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert or update or delete on public.buildings for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.court_orders for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.disputes for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.exemptions for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.invoices for each row execute function private.parcel_archive_guard();
create trigger archive_guard_cancel before update of status on public.invoices for each row
  when (new.status = 'cancelled' and old.status <> 'cancelled') execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.issued_documents for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.leases for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.liens for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.payment_plans for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.permits for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.public_notices for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.surveys for each row execute function private.parcel_archive_guard();
create trigger archive_guard before insert on public.transfers for each row execute function private.parcel_archive_guard();

-- Printing or reprinting a certificate of demolished land.
create function private.document_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.issued_documents d join public.parcels p on p.id = d.parcel_id
              where d.id = new.document_id and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  return new;
end;
$$;
revoke all on function private.document_archive_guard() from public, anon, authenticated;
create trigger archive_guard before insert on public.print_jobs for each row execute function private.document_archive_guard();
create trigger archive_guard before insert on public.reprint_requests for each row execute function private.document_archive_guard();

-- Subdividing and merging.
create function private.parcel_change_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.parcels p where p.id = any (new.parcel_ids) and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  return new;
end;
$$;
revoke all on function private.parcel_change_archive_guard() from public, anon, authenticated;
create trigger archive_guard before insert on public.parcel_changes for each row execute function private.parcel_change_archive_guard();

-- The land itself: edits, locks, deleting, site checks. Undo, Register again and the demolishing of a building change its
-- state or status, or run under app.land_change, so they pass.
create function private.parcel_row_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.building_state = 'demolished' and new.building_state = 'demolished' and new.status = old.status
     and coalesce(current_setting('app.land_change', true), '') <> 'on' then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  return new;
end;
$$;
revoke all on function private.parcel_row_archive_guard() from public, anon, authenticated;
create trigger archive_guard before update on public.parcels for each row execute function private.parcel_row_archive_guard();

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
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
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
  if exists (select 1 from public.parcels p where p.id = v_inv.parcel_id and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
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

  -- Money that arrives for land not registered yet, or demolished, is kept, waiting in the matching queue with nothing paid.
  if exists (select 1 from public.parcels p where p.id = v_parcel and (p.status in ('draft', 'surveyed', 'verified') or p.building_state = 'demolished')) then
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

create or replace function public.invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('number', i.number, 'pun', p.pun, 'period', i.period, 'fee', f.name_en, 'fee_so', f.name_so,
                            'due_date', i.due_date, 'total', i.total, 'paid', i.paid + i.credited, 'balance', i.balance,
                            'status', i.status, 'currency', i.currency, 'partial', p.status in ('draft', 'surveyed', 'verified'), 'demolished', p.building_state = 'demolished')
  from public.invoice_tokens t join public.invoices i on i.id = t.invoice_id
  join public.parcels p on p.id = i.parcel_id join public.fee_types f on f.id = i.fee_type_id
  where t.token = p_token and length(p_token) = 64 and i.status <> 'cancelled';
$$;

create or replace function public.cashier_to_collect(p_district uuid default null)
returns table (invoice_id uuid, invoice_number text, fee_name_so text, fee_name_en text, total numeric, balance numeric, due_date date,
               parcel_id uuid, pun text, house_no text, neighbourhood_so text, neighbourhood_en text, district_id uuid,
               district_so text, district_en text, owners text, pay_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desk_district uuid;
  v_district uuid;
begin
  if not public.has_permission('cashier.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'cashier.view');
  end if;
  v_desk_district := coalesce(
    (select pos.district_id from public.cashier_shifts s join public.points_of_sale pos on pos.id = s.pos_id
      where s.cashier_id = auth.uid() and s.status = 'open' order by s.opened_at desc limit 1),
    (select pos.district_id from public.profiles pr join public.points_of_sale pos on pos.id = pr.point_of_sale_id
      where pr.user_id = auth.uid()));
  v_district := case when private.my_desk() is not null then v_desk_district else coalesce(p_district, v_desk_district) end;
  return query
    select i.id, i.number, ft.name_so, ft.name_en, i.total, i.balance, i.due_date,
           p.id, p.pun, p.house_no, n.name_so, n.name_en, d.id, d.name_so, d.name_en,
           (select string_agg(pa.full_name, ', ' order by po.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = p.id and po.valid_to is null),
           '/pay/' || t.token
      from public.invoices i
      join public.parcels p on p.id = i.parcel_id
      join public.districts d on d.id = p.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join public.invoice_tokens t on t.invoice_id = i.id
     where i.status in ('issued', 'partially_paid') and i.balance > 0
       and p.deleted_at is null and p.status in ('registered', 'disputed') and p.building_state = 'standing'
       and public.can_access_district(p.district_id) and (v_district is null or p.district_id = v_district)
     order by d.name_en, n.name_en nulls last, p.house_no nulls last, p.pun, i.issue_date, i.number
     limit 2000;
end;
$$;

create or replace function public.apply_late_penalties(p_as_of date default current_date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pct numeric := private.setting_numeric('billing.penalty_pct', 0);
  v_grace int := private.setting_int('billing.penalty_grace_days', 30);
  r record;
  v_amount numeric;
  v_count int := 0;
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null and current_user in ('postgres', 'service_role');
begin
  if not v_service then
    perform private.assert_permission('billing.update');
  end if;
  if v_pct <= 0 then
    return 0;
  end if;
  for r in
    select i.id, i.parcel_id, i.balance, i.number from public.invoices i
    where i.status in ('issued', 'partially_paid') and i.balance > 0 and i.penalty_applied_at is null
      and i.due_date + v_grace < p_as_of
      and (v_service or public.can_access_district(i.district_id))
      and not exists (select 1 from public.parcels o where o.id = i.parcel_id and o.building_state = 'demolished')
      and not exists (select 1 from public.payment_plan_invoices ppi join public.payment_plans pp on pp.id = ppi.plan_id
                      where ppi.invoice_id = i.id and pp.status in ('pending', 'active'))
    for update of i skip locked
  loop
    v_amount := round(r.balance * v_pct / 100, 2);
    if v_amount > 0 then
      update public.invoices set total = total + v_amount, penalty_applied_at = now() where id = r.id;
      insert into public.invoice_lines (invoice_id, kind, description, amount)
      values (r.id, 'penalty', 'Late payment penalty ' || v_pct || '%', v_amount);
      perform private.invoice_refresh_status(r.id);
      perform private.parcel_event(r.parcel_id, 'penalty_applied', null, jsonb_build_object('invoice_id', r.id, 'amount', v_amount));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.assess_neighbourhood(p_neighbourhood uuid, p_year int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid;
  v_parcel uuid;
  v_done int := 0;
  v_skipped int := 0;
begin
  perform private.assert_permission('valuation.create');
  select district_id into v_district from public.neighbourhoods where id = p_neighbourhood;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  for v_parcel in select id from public.parcels where neighbourhood_id = p_neighbourhood and status = 'registered' and building_state = 'standing' and deleted_at is null loop
    if exists (select 1 from public.appeals a join public.assessments s on s.id = a.assessment_id
               where s.parcel_id = v_parcel and s.year = p_year and a.status = 'open') then
      v_skipped := v_skipped + 1;
    else
      perform public.assess_parcel(v_parcel, p_year);
      v_done := v_done + 1;
    end if;
  end loop;
  return jsonb_build_object('assessed', v_done, 'skipped', v_skipped);
end;
$$;

-- No new yearly bills for demolished land.
create or replace function private.billing_run_candidates(p_run public.billing_runs)
returns table (parcel_id uuid, district_id uuid, assessment_id uuid, amount numeric, lines jsonb, exception text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.parcel_id, c.district_id, c.assessment_id, c.amount, c.lines, c.exception
    from private.billing_run_candidates_all(p_run) c
    join public.parcels p on p.id = c.parcel_id
   where p.layout = 'house' and p.building_state = 'standing';
$$;

create or replace function private.certificate_blockers(p_parcel uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.parcels where id = p_parcel and building_state = 'demolished') then
    return array['demolished'];
  end if;
  if exists (select 1 from public.parcels where id = p_parcel and layout <> 'house') then
    return array['has_units'];
  end if;
  return private.certificate_blockers_land(p_parcel);
end;
$$;

-- The Invoices page: registered, partial and demolished land apart.
drop function public.invoices_by_land();
create function public.invoices_by_land()
returns table (land text, invoices bigint, owed numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p.building_state = 'demolished' then 'demolished'
              when p.status in ('draft', 'surveyed', 'verified') then 'partial' else 'registered' end, count(*),
         coalesce(sum(i.balance) filter (where i.status in ('issued', 'partially_paid')), 0)
    from public.invoices i
    join public.parcels p on p.id = i.parcel_id
   where i.status <> 'cancelled'
   group by 1;
$$;
revoke all on function public.invoices_by_land() from public, anon;
grant execute on function public.invoices_by_land() to authenticated;
