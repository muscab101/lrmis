-- No approval for land registration or owners any more: partial land's bills can be paid (at a desk or online), and
-- once all of its bills are paid the land registers by itself (its owners with it). Exemptions and appeals are no
-- longer used. Applications keeps land changes, demolitions, transfers, certificates, accounting and messages.

-- 1. Partial land's bills can be paid.
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
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.layout = 'compound') then
    perform private.raise_app_error('CONFLICT', 'land_has_units');
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  return new;
end;
$$;

do $$
declare
  d text := pg_get_functiondef('public.payment_intent_create(uuid,text,text,text)'::regprocedure);
  a text := '  if exists (select 1 from public.parcels p where p.id = v_inv.parcel_id and p.status in (''draft'', ''surveyed'', ''verified'')) then
    perform private.raise_app_error(''CONFLICT'', ''bill_needs_registered'');
  end if;
';
  c text := pg_get_functiondef('public.cashier_to_collect(uuid)'::regprocedure);
  ca text := 'p.status in (''registered'', ''disputed'') and p.building_state = ''standing''';
  cb text := 'p.status in (''registered'', ''disputed'', ''draft'', ''surveyed'', ''verified'') and p.building_state = ''standing''';
begin
  if position(a in d) = 0 or position(ca in c) = 0 then
    raise exception 'partial land payment blocks not found';
  end if;
  execute replace(d, a, '');
  execute replace(c, ca, cb);
end $$;

-- 2. Registering land checks the person's power, except when it registers by itself (all bills paid).
do $$
declare
  f text;
  d text;
  a1 text := 'perform private.assert_permission(''parcels.approve'');';
  b1 text := 'if current_setting(''app.auto_register'', true) is distinct from ''on'' then perform private.assert_permission(''parcels.approve''); end if;';
  a2 text := 'if v.id is null or not public.can_access_district(v.district_id) then';
  b2 text := 'if v.id is null or (current_setting(''app.auto_register'', true) is distinct from ''on'' and not public.can_access_district(v.district_id)) then';
begin
  foreach f in array array['public.parcel_register(uuid,land_use,text)', 'private.parcel_register_one(uuid,land_use,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(a1 in d) = 0 then
      raise exception '%: permission check not found', f;
    end if;
    d := replace(d, a1, b1);
    d := replace(d, a2, b2);
    execute d;
  end loop;
end $$;

/** Partial land whose bills are all paid registers by itself (with a PUN; its owners are registered with it). */
create or replace function private.parcel_auto_register(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  if current_setting('app.migration', true) = 'on' then
    return;
  end if;
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  if v.id is null or v.status not in ('draft', 'surveyed', 'verified') or v.locked_at is not null or v.layout <> 'house' then
    return;
  end if;
  -- Land still in an application (survey, public notice) is registered there.
  if v.application_id is not null and exists (select 1 from public.applications ap where ap.id = v.application_id and ap.status not in ('approved', 'rejected', 'cancelled')) then
    return;
  end if;
  if not exists (select 1 from public.invoices i where i.parcel_id = v.id and i.status = 'paid')
     or exists (select 1 from public.invoices i where i.parcel_id = v.id and i.status not in ('paid', 'cancelled') and i.balance > 0) then
    return;
  end if;
  begin
    perform set_config('app.auto_register', 'on', true);
    perform public.parcel_register(v.id, null, 'Registered by itself: its bills are paid');
    perform set_config('app.auto_register', '', true);
  exception when others then
    -- Something stops it (no owner, no place, a failed site check): the payment stays, and the reason is kept.
    perform set_config('app.auto_register', '', true);
    perform private.parcel_event(v.id, 'auto_register_failed', left(sqlerrm, 200), '{}'::jsonb);
  end;
end;
$$;
revoke all on function private.parcel_auto_register(uuid) from public, anon, authenticated;

create or replace function private.invoice_paid_register()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.parcel_id is not null then
    perform private.parcel_auto_register(new.parcel_id);
  end if;
  return new;
end;
$$;
drop trigger if exists paid_register on public.invoices;
create trigger paid_register after update of status on public.invoices
  for each row execute function private.invoice_paid_register();

-- 3. Applications: no land registration, owners, exemptions or appeals any more.
create or replace function public.approvals_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    perform private.raise_app_error('PERMISSION_DENIED', 'signed_out');
  end if;

  -- Land changes (split, change of use): a second person approves them.
  if public.has_permission('parcels.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'land_change', 'id', c.id, 'ref', c.number,
        'title', (select string_agg(p.pun, ', ') from public.parcels p where p.id = any (c.parcel_ids)), 'detail', c.reason,
        'amount', null, 'by_id', c.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/parcels/changes', 'district_id', c.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('change', c.kind, 'parcels', cardinality(c.parcel_ids)))) x
        from public.parcel_changes c
       where c.status = 'submitted' and public.can_access_district(c.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('parcels.demolish_approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'demolition', 'id', d.id, 'ref', d.number, 'title', coalesce(d.owner_names, ''),
        'detail', d.reason, 'amount', null, 'by_id', d.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = d.requested_by),
        'at', d.requested_at, 'href', '/demolished/' || d.id, 'district_id', d.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('pun', d.pun, 'house_no', d.house_no, 'demolished_date', d.demolition_date))) x
        from public.demolitions d
       where d.status = 'pending' and public.can_access_district(d.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('transfers.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'transfer', 'id', tr.id, 'ref', tr.number,
        'title', coalesce((select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(tr.to_owners) o), ''),
        'detail', tr.note, 'amount', tr.declared_value, 'by_id', tr.created_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = tr.created_by),
        'at', coalesce(tr.submitted_at, tr.created_at), 'href', '/transfers/' || tr.id, 'district_id', tr.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'pun', p.pun, 'house_no', p.house_no,
          'from_owners', (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(tr.from_owners) o),
          'transfer_type', (select tt.name_en from public.transfer_types tt where tt.id = tr.type_id),
          'duty_usd', di.total, 'duty_status', di.status))) x
        from public.transfers tr
        left join public.parcels p on p.id = tr.parcel_id
        left join public.invoices di on di.id = tr.duty_invoice_id
       where tr.status = 'submitted' and public.can_access_district(tr.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('certificates.approve') then
    -- Registered land with its bills paid and no certificate yet: Approve issues it.
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'certificate_issue', 'id', p.id, 'ref', p.pun,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', null, 'amount', null, 'by_id', null, 'by', null, 'at', p.registered_at, 'href', '/parcels/' || p.id,
        'district_id', p.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'house_no', p.house_no,
          'neighbourhood', (select n.name_en from public.neighbourhoods n where n.id = p.neighbourhood_id),
          'area_m2', p.area_m2,
          'paid_usd', (select sum(i.paid) from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'),
          'registered_date', p.registered_at))) x
        from public.parcels p
       where p.deleted_at is null and p.status = 'registered' and p.layout = 'house' and p.building_state <> 'demolished'
         and public.can_access_district(p.district_id)
         and not exists (select 1 from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status = 'valid')
         and not exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid') and i.balance > 0)
         and exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status = 'paid')
       order by p.registered_at limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'reprint', 'id', r.id, 'ref', d.serial,
        'title', coalesce((select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(coalesce(d.snapshot -> 'owners', '[]')) o), ''),
        'detail', r.reason, 'amount', null, 'by_id', r.requested_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = r.requested_by),
        'at', r.requested_at, 'href', '/documents/' || d.id, 'district_id', d.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'request', r.kind, 'document', d.type, 'pun', d.snapshot ->> 'pun',
          'printed', d.print_count, 'fee_usd', fi.total, 'fee_status', fi.status))) x
        from public.reprint_requests r join public.issued_documents d on d.id = r.document_id
        left join public.invoices fi on fi.id = r.fee_invoice_id
       where r.status = 'pending' and public.can_access_district(d.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('invoices.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'credit_note', 'id', c.id, 'ref', c.number,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = i.parcel_id and po.valid_to is null), ''),
        'detail', c.reason, 'amount', c.amount, 'by_id', c.requested_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/invoices/' || i.id, 'district_id', i.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'invoice', i.number, 'pun', (select p.pun from public.parcels p where p.id = i.parcel_id),
          'invoice_usd', i.total, 'paid_usd', i.paid, 'balance_usd', i.balance))) x
        from public.credit_notes c join public.invoices i on i.id = c.invoice_id
       where c.status = 'pending' and private.can_view_invoice_district(i.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('billing.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'payment_plan', 'id', pl.id, 'ref', pl.number,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = pl.parcel_id and po.valid_to is null), ''),
        'detail', pl.note, 'amount', pl.total, 'by_id', pl.requested_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = pl.requested_by),
        'at', pl.requested_at, 'href', '/parcels/' || pl.parcel_id, 'district_id', pl.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'pun', (select p.pun from public.parcels p where p.id = pl.parcel_id),
          'instalments', pl.instalments, 'start_date', pl.start_date))) x
        from public.payment_plans pl
       where pl.status = 'pending' and public.can_access_district(pl.district_id)
       limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'billing_run', 'id', b.id, 'ref', b.number,
        'title', (select f.name_en from public.fee_types f where f.id = b.fee_type_id), 'detail', b.note,
        'amount', b.total, 'by_id', b.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = b.created_by),
        'at', coalesce(b.submitted_at, b.created_at), 'href', '/billing/runs/' || b.id,
        'district_id', case when cardinality(b.district_ids) = 1 then b.district_ids[1] end,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'period', b.period, 'invoices', b.invoice_count, 'issue_date', b.issue_date, 'due_date', b.due_date,
          'districts', case when cardinality(b.district_ids) > 1 then cardinality(b.district_ids) end))) x
        from public.billing_runs b
       where b.status = 'submitted'
         and (coalesce(cardinality(b.district_ids), 0) = 0 or exists (select 1 from unnest(b.district_ids) d where public.can_access_district(d)))
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('payments.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'payment_correction', 'id', c.id, 'ref', c.number, 'title', pm.payer_name, 'detail', c.reason,
        'amount', pm.amount, 'by_id', c.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/payments/' || pm.id, 'district_id', pm.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'receipt', pm.receipt_no, 'method', pm.method, 'received_date', pm.received_at,
          'pun', (select p.pun from public.parcels p where p.id = pm.parcel_id),
          'changes', (select string_agg(k, ', ') from jsonb_object_keys(coalesce(c.changes, '{}'::jsonb)) k)))) x
        from public.payment_corrections c join public.payments pm on pm.id = c.payment_id
       where c.status = 'pending' and private.can_view_payment(pm.district_id, pm.parcel_id)
       limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'reversal', 'id', r.id, 'ref', pm.receipt_no, 'title', pm.payer_name, 'detail', r.reason,
        'amount', pm.amount, 'by_id', r.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = r.requested_by),
        'at', r.requested_at, 'href', '/payments/' || pm.id, 'district_id', pm.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'method', pm.method, 'received_date', pm.received_at, 'phone', pm.payer_phone,
          'pun', (select p.pun from public.parcels p where p.id = pm.parcel_id)))) x
        from public.payment_reversals r join public.payments pm on pm.id = r.payment_id
       where r.status = 'pending' and private.can_view_payment(pm.district_id, pm.parcel_id)
       limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'shift', 'id', s.id, 'ref', s.number,
        'title', (select pr.full_name from public.profiles pr where pr.user_id = s.cashier_id),
        'detail', s.close_note, 'amount', s.difference, 'by_id', s.cashier_id,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = s.cashier_id),
        'at', s.closed_at, 'href', '/payments?tab=shifts', 'district_id', s.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'desk', (select ps.name from public.points_of_sale ps where ps.id = s.pos_id),
          'opened_date', s.opened_at, 'expected_usd', s.expected_cash, 'counted_usd', s.counted_cash,
          'payments', (select count(*) from public.payments pm where pm.shift_id = s.id and pm.status <> 'reversed')))) x
        from public.cashier_shifts s
       where s.status = 'closed' and public.can_access_district(s.district_id)
       limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'commission_payout', 'id', c.id, 'ref', c.number, 'title', c.party, 'detail', c.reference,
        'amount', c.amount, 'by_id', c.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.created_by),
        'at', c.created_at, 'href', '/accounting', 'district_id', null,
        'facts', jsonb_strip_nulls(jsonb_build_object('upto_date', c.upto, 'account', c.payable_account, 'paid_from', c.paid_from))) x
        from public.commission_payouts c
       where c.status = 'pending'
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('reconciliation.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'cashier_recon', 'id', c.id, 'ref', c.number,
        'title', (select pr.full_name from public.profiles pr where pr.user_id = c.cashier_id),
        'detail', c.note, 'amount', c.difference, 'by_id', c.prepared_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = c.prepared_by),
        'at', c.prepared_at, 'href', '/collections/reconcile?cashier=' || c.cashier_id || '&date=' || c.business_date, 'district_id', c.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('day_date', c.business_date, 'recorded_usd', c.recorded, 'actual_usd', c.actual))) x
        from public.cashier_reconciliations c
       where c.status = 'submitted' and public.can_access_district(c.district_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('reconciliation.update') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'payment', 'id', p.id, 'ref', p.receipt_no, 'title', p.payer_name, 'detail', p.note,
        'amount', p.amount_base, 'by_id', null, 'by', null, 'at', p.received_at, 'href', '/payments/' || p.id, 'district_id', p.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('method', p.method, 'provider', p.provider, 'reference', coalesce(p.provider_ref, p.reference),
          'phone', p.payer_phone, 'pun', (select pa.pun from public.parcels pa where pa.id = p.parcel_id), 'received_date', p.received_at))) x
        from public.payments p
       where p.verify_status = 'pending' and p.status <> 'reversed' and p.created_by is null
         and private.can_view_payment(p.district_id, p.parcel_id)
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('accounting.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'movement', 'id', m.id, 'ref', m.number, 'title', coalesce(m.party, m.kind), 'detail', m.note,
        'amount', m.amount, 'by_id', m.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = m.created_by),
        'at', m.created_at, 'href', '/accounting?tab=deposits', 'district_id', m.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'movement', m.kind, 'movement_date', m.movement_date, 'debit', m.debit_account, 'credit', m.credit_account,
          'reference', m.reference))) x
        from public.money_movements m
       where m.status = 'pending' and (m.district_id is null or public.can_access_district(m.district_id))
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('messages.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'campaign', 'id', m.id, 'ref', m.number, 'title', m.template_code, 'detail', m.note,
        'amount', null, 'by_id', m.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = m.created_by),
        'at', m.created_at, 'href', '/messages', 'district_id', m.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('audience', m.audience #>> '{}'))) x
        from public.message_campaigns m
       where m.status = 'draft' and (m.district_id is null or public.can_access_district(m.district_id))
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('payments.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'commission_rule', 'id', r.id, 'ref', r.code || ' v' || r.version, 'title', r.name, 'detail', r.note,
        'amount', r.fixed_amount, 'by_id', r.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = r.created_by),
        'at', r.created_at, 'href', '/accounting', 'district_id', r.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('party', r.party, 'pct', r.pct, 'from_date', r.effective_from, 'until_date', r.effective_to))) x
        from public.commission_rules r
       where r.status = 'draft' and (r.district_id is null or public.can_access_district(r.district_id))
       limit 300) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('reconciliation.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'recon_batch', 'id', b.id, 'ref', b.number, 'title', b.provider, 'detail', b.note,
        'amount', null, 'by_id', b.submitted_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = b.submitted_by),
        'at', coalesce(b.submitted_at, b.created_at), 'href', '/collections?tab=statements&batch=' || b.id, 'district_id', null,
        'facts', jsonb_strip_nulls(jsonb_build_object('from_date', b.date_from, 'until_date', b.date_to))) x
        from public.reconciliation_batches b
       where b.status = 'submitted'
       limit 300) t(x)), '[]'::jsonb);
  end if;

  -- Payments taken at a desk, waiting to be approved: one item per desk and cashier (online: per district).
  if public.has_permission('reconciliation.update') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'pos_payments', 'id', s.id, 'ref', s.code,
        'title', coalesce((select pr.full_name from public.profiles pr where pr.user_id = g.cashier), s.name), 'detail', null,
        'amount', g.total, 'by_id', g.cashier, 'by', (select pr.full_name from public.profiles pr where pr.user_id = g.cashier),
        'at', g.first_at, 'href', '/collections?tab=pos', 'district_id', coalesce(g.district_id, s.district_id),
        'extra', jsonb_strip_nulls(jsonb_build_object('cashier', g.cashier, 'district', g.district_id, 'from', g.d_from, 'to', g.d_to)),
        'facts', jsonb_build_object('desk', s.name, 'payments', g.n, 'from_date', g.d_from, 'until_date', g.d_to)) x
        from (select p.pos_id, p.created_by as cashier, case when ps.kind = 'online' then p.district_id end as district_id,
                     count(*) as n, sum(p.amount_base) as total, min(p.received_at) as first_at,
                     min(p.received_at)::date as d_from, max(p.received_at)::date as d_to
                from public.payments p join public.points_of_sale ps on ps.id = p.pos_id
               where p.verify_status = 'pending' and p.status <> 'reversed' and p.created_by is not null
                 and private.can_view_payment(p.district_id, p.parcel_id)
               group by 1, 2, 3) g
        join public.points_of_sale s on s.id = g.pos_id
       limit 300) t(x)), '[]'::jsonb);
  end if;

  -- Each item with its district's name, and whether this person asked for it.
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(i || jsonb_build_object(
             'mine', (i ->> 'by_id') = v_uid::text,
             'district', (select jsonb_build_object('code', d.code, 'name_so', d.name_so, 'name_en', d.name_en)
                            from public.districts d where d.id = nullif(i ->> 'district_id', '')::uuid))
             order by i ->> 'at'), '[]'::jsonb)
      from jsonb_array_elements(v_items) i));
end;
$$;
revoke all on function public.approvals_inbox() from public, anon;
grant execute on function public.approvals_inbox() to authenticated;
