-- Applications is the one place to approve: everything that waits for an approval is listed here (land and owners,
-- transfers, certificates, accounting, valuation, messages), each with its district and the facts to decide on. Other
-- pages no longer approve. New here: message campaigns, commission rules, bank statement checks and desk payments.

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

  -- Land not registered yet: Approve moves it to registered.
  if public.has_permission('parcels.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'land_register', 'id', p.id, 'ref', coalesce(p.pun, p.house_no),
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', null, 'amount', null, 'by_id', p.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = p.created_by),
        'at', p.created_at, 'href', '/parcels/' || p.id, 'district_id', p.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'house_no', p.house_no, 'neighbourhood', (select n.name_en from public.neighbourhoods n where n.id = p.neighbourhood_id),
          'property_type', (select g.name_en from public.property_grades g where g.code = p.property_type),
          'area_m2', p.area_m2,
          'bill_usd', (select i.total from public.invoices i join public.fee_types f on f.id = i.fee_type_id
                        where i.parcel_id = p.id and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1)))) x
        from public.parcels p
       where p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified') and p.locked_at is null
         and p.layout = 'house' and public.can_access_district(p.district_id)
       limit 300) t(x)), '[]'::jsonb);

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

  if public.has_permission('owners.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'owner', 'id', o.id, 'ref', o.id_number, 'title', o.full_name, 'detail', null,
        'amount', null, 'by_id', o.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = o.created_by),
        'at', o.created_at, 'href', '/owners/' || o.id, 'district_id', o.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('phone', o.phone, 'mother', o.mother_name,
          'owner_type', (select ot.name_en from public.owner_types ot where ot.id = o.owner_type_id),
          'land', (select count(*) from public.parcel_owners po where po.party_id = o.id and po.valid_to is null)))) x
        from public.parties o
       where o.deleted_at is null and o.registered_at is null and (o.district_id is null or public.can_access_district(o.district_id))
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

  if public.has_permission('valuation.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'exemption', 'id', e.id, 'ref', p.pun,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', e.reason, 'amount', null, 'by_id', e.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = e.requested_by),
        'at', e.requested_at, 'href', '/valuation?tab=requests', 'district_id', p.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('exemption', e.kind, 'pct', e.pct, 'from_date', e.valid_from, 'until_date', e.valid_to))) x
        from public.exemptions e join public.parcels p on p.id = e.parcel_id
       where e.status = 'pending' and public.can_access_district(p.district_id)
       limit 300) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'appeal', 'id', a.id, 'ref', p.pun,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', a.reason, 'amount', a.requested_total, 'by_id', a.filed_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = a.filed_by),
        'at', a.filed_at, 'href', '/valuation?tab=requests', 'district_id', p.district_id,
        'facts', jsonb_strip_nulls(jsonb_build_object('requested_usd', a.requested_total, 'house_no', p.house_no))) x
        from public.appeals a join public.parcels p on p.id = a.parcel_id
       where a.status = 'open' and public.can_access_district(p.district_id)
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

-- Approve or turn down one item from the Applications page; each kind goes to its own approval step, which checks the
-- power, the district and maker-checker as before. p_extra carries what some kinds need (a cashier and days, a new total).
drop function if exists public.approval_decide(text, uuid, boolean, text);
create or replace function public.approval_decide(p_kind text, p_id uuid, p_approve boolean, p_note text default null, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_out jsonb;
  e jsonb := coalesce(p_extra, '{}'::jsonb);
begin
  if not p_approve and p_kind in ('land_register', 'owner', 'certificate_issue', 'shift', 'billing_run', 'commission_rule', 'pos_payments') then
    perform private.raise_app_error('CONFLICT', 'open_to_decide');
  end if;
  if not p_approve and v_note is null then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  case p_kind
    when 'land_register' then v_out := public.parcel_register(p_id);
    when 'land_change' then v_out := public.parcel_change_decide(p_id, p_approve, v_note);
    when 'demolition' then perform public.demolition_decide(array[p_id], p_approve, v_note);
    when 'owner' then perform public.party_register(p_id);
    when 'transfer' then perform public.transfer_decide(p_id, p_approve, v_note);
    when 'certificate_issue' then v_out := public.certificate_issue(p_id);
    when 'reprint' then v_out := public.reprint_decide(p_id, p_approve, v_note);
    when 'credit_note' then perform public.credit_note_decide(p_id, p_approve, v_note);
    when 'payment_plan' then perform public.payment_plan_decide(p_id, p_approve, v_note);
    when 'billing_run' then perform public.billing_run_approve(p_id);
    when 'payment_correction' then perform public.payment_correction_decide(p_id, p_approve, v_note);
    when 'reversal' then perform public.reversal_decide(p_id, p_approve, v_note);
    when 'shift' then perform public.shift_approve(p_id);
    when 'commission_payout' then perform public.commission_payout_decide(p_id, p_approve, v_note);
    when 'commission_rule' then perform public.commission_rule_approve(p_id);
    when 'cashier_recon' then perform public.cashier_recon_decide(p_id, p_approve, v_note);
    when 'recon_batch' then perform public.recon_batch_decide(p_id, p_approve, v_note);
    when 'pos_payments' then
      perform public.pos_cashier_approve(p_id, (e ->> 'cashier')::uuid, (e ->> 'from')::date, (e ->> 'to')::date, nullif(e ->> 'district', '')::uuid);
    when 'movement' then perform public.movement_decide(p_id, p_approve, v_note);
    when 'exemption' then perform public.exemption_decide(p_id, p_approve, v_note);
    when 'appeal' then
      perform public.appeal_decide(p_id, (case when p_approve then 'upheld' else 'rejected' end)::public.appeal_status,
                                   case when p_approve then nullif(e ->> 'new_total', '')::numeric end, v_note);
    when 'campaign' then perform public.campaign_decide(p_id, p_approve, v_note);
    else perform private.raise_app_error('VALIDATION', 'kind');
  end case;
  return coalesce(v_out, 'null'::jsonb);
end;
$$;
revoke all on function public.approval_decide(text, uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.approval_decide(text, uuid, boolean, text, jsonb) to authenticated;
