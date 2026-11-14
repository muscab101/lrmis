-- Applications: one page for everything that waits for someone's approval: land to register, land changes,
-- demolitions, owners, transfers, certificates and reprints, money (credit notes, plans, corrections, reversals,
-- shifts, cash counts, movements, commission payouts, billing runs) and valuation (exemptions, appeals).
-- Each person sees only the kinds they may approve, in their own districts.

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
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'land_register', 'id', p.id, 'ref', coalesce(p.pun, p.house_no),
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', (select n.name_en from public.neighbourhoods n where n.id = p.neighbourhood_id),
        'amount', null, 'by_id', p.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = p.created_by),
        'at', p.created_at, 'href', '/parcels/' || p.id) x
        from public.parcels p
       where p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified') and p.locked_at is null
         and p.layout = 'house' and public.can_access_district(p.district_id)
       order by p.created_at limit 200) t(x)), '[]'::jsonb);

    -- Land changes (boundary, subdivide, change of use).
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'land_change', 'id', c.id, 'ref', c.number, 'title', c.kind, 'detail', c.reason,
        'amount', null, 'by_id', c.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/parcels/changes') x
        from public.parcel_changes c
       where c.status = 'submitted' and public.can_access_district(c.district_id)
       order by c.requested_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('parcels.demolish_approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'demolition', 'id', d.id, 'ref', d.number, 'title', coalesce(d.owner_names, d.pun, ''),
        'detail', d.reason, 'amount', null, 'by_id', d.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = d.requested_by),
        'at', d.requested_at, 'href', '/demolished/' || d.id) x
        from public.demolitions d
       where d.status = 'pending' and public.can_access_district(d.district_id)
       order by d.requested_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('owners.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'owner', 'id', o.id, 'ref', o.id_number, 'title', o.full_name, 'detail', o.phone,
        'amount', null, 'by_id', o.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = o.created_by),
        'at', o.created_at, 'href', '/owners/' || o.id) x
        from public.parties o
       where o.deleted_at is null and o.registered_at is null and (o.district_id is null or public.can_access_district(o.district_id))
       order by o.created_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('transfers.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'transfer', 'id', tr.id, 'ref', tr.number,
        'title', coalesce((select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(tr.to_owners) o), ''),
        'detail', (select p.pun from public.parcels p where p.id = tr.parcel_id),
        'amount', tr.declared_value, 'by_id', tr.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = tr.created_by),
        'at', coalesce(tr.submitted_at, tr.created_at), 'href', '/transfers/' || tr.id) x
        from public.transfers tr
       where tr.status = 'submitted' and public.can_access_district(tr.district_id)
       order by tr.submitted_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('certificates.approve') then
    -- Registered land with its bills paid and no certificate yet: Approve issues it.
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'certificate_issue', 'id', p.id, 'ref', p.pun,
        'title', coalesce((select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                            where po.parcel_id = p.id and po.valid_to is null), ''),
        'detail', p.house_no, 'amount', null, 'by_id', null, 'by', null, 'at', p.registered_at, 'href', '/parcels/' || p.id) x
        from public.parcels p
       where p.deleted_at is null and p.status = 'registered' and p.layout = 'house' and p.building_state <> 'demolished'
         and public.can_access_district(p.district_id)
         and not exists (select 1 from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status = 'valid')
         and not exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid') and i.balance > 0)
         and exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status = 'paid')
       order by p.registered_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'reprint', 'id', r.id, 'ref', d.serial, 'title', r.kind, 'detail', r.reason,
        'amount', null, 'by_id', r.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = r.requested_by),
        'at', r.requested_at, 'href', '/documents/' || d.id) x
        from public.reprint_requests r join public.issued_documents d on d.id = r.document_id
       where r.status = 'pending' and public.can_access_district(d.district_id)
       order by r.requested_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('invoices.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'credit_note', 'id', c.id, 'ref', c.number, 'title', i.number, 'detail', c.reason,
        'amount', c.amount, 'by_id', c.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/invoices/' || i.id) x
        from public.credit_notes c join public.invoices i on i.id = c.invoice_id
       where c.status = 'pending' and private.can_view_invoice_district(i.district_id)
       order by c.requested_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('billing.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'payment_plan', 'id', pl.id, 'ref', pl.number, 'title', (select p.pun from public.parcels p where p.id = pl.parcel_id),
        'detail', pl.instalments || ' × · ' || coalesce(pl.note, ''), 'amount', pl.total, 'by_id', pl.requested_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = pl.requested_by),
        'at', pl.requested_at, 'href', '/parcels/' || pl.parcel_id) x
        from public.payment_plans pl
       where pl.status = 'pending' and public.can_access_district(pl.district_id)
       order by pl.requested_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'billing_run', 'id', b.id, 'ref', b.number, 'title', b.period, 'detail', b.invoice_count || ' invoices',
        'amount', b.total, 'by_id', b.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = b.created_by),
        'at', coalesce(b.submitted_at, b.created_at), 'href', '/billing/runs/' || b.id) x
        from public.billing_runs b
       where b.status = 'submitted'
       order by b.submitted_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('payments.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'payment_correction', 'id', c.id, 'ref', c.number, 'title', pm.receipt_no, 'detail', c.reason,
        'amount', pm.amount, 'by_id', c.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.requested_by),
        'at', c.requested_at, 'href', '/payments/' || pm.id) x
        from public.payment_corrections c join public.payments pm on pm.id = c.payment_id
       where c.status = 'pending' and private.can_view_payment(pm.district_id, pm.parcel_id)
       order by c.requested_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'reversal', 'id', r.id, 'ref', pm.receipt_no, 'title', pm.payer_name, 'detail', r.reason,
        'amount', pm.amount, 'by_id', r.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = r.requested_by),
        'at', r.requested_at, 'href', '/payments/' || pm.id) x
        from public.payment_reversals r join public.payments pm on pm.id = r.payment_id
       where r.status = 'pending' and private.can_view_payment(pm.district_id, pm.parcel_id)
       order by r.requested_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'shift', 'id', s.id, 'ref', s.number, 'title', (select pr.full_name from public.profiles pr where pr.user_id = s.cashier_id),
        'detail', s.close_note, 'amount', s.difference, 'by_id', s.cashier_id, 'by', (select pr.full_name from public.profiles pr where pr.user_id = s.cashier_id),
        'at', s.closed_at, 'href', '/collections/reconcile') x
        from public.cashier_shifts s
       where s.status = 'closed' and public.can_access_district(s.district_id)
       order by s.closed_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'commission_payout', 'id', c.id, 'ref', c.number, 'title', c.party, 'detail', c.reference,
        'amount', c.amount, 'by_id', c.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = c.created_by),
        'at', c.created_at, 'href', '/accounting') x
        from public.commission_payouts c
       where c.status = 'pending'
       order by c.created_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('reconciliation.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'cashier_recon', 'id', c.id, 'ref', c.number, 'title', (select pr.full_name from public.profiles pr where pr.user_id = c.cashier_id),
        'detail', c.business_date::text, 'amount', c.difference, 'by_id', c.prepared_by,
        'by', (select pr.full_name from public.profiles pr where pr.user_id = c.prepared_by),
        'at', c.prepared_at, 'href', '/collections/reconcile') x
        from public.cashier_reconciliations c
       where c.status = 'submitted' and public.can_access_district(c.district_id)
       order by c.prepared_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('accounting.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'movement', 'id', m.id, 'ref', m.number, 'title', coalesce(m.party, m.kind), 'detail', m.note,
        'amount', m.amount, 'by_id', m.created_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = m.created_by),
        'at', m.created_at, 'href', '/accounting?tab=deposits') x
        from public.money_movements m
       where m.status = 'pending' and (m.district_id is null or public.can_access_district(m.district_id))
       order by m.created_at limit 200) t(x)), '[]'::jsonb);
  end if;

  if public.has_permission('valuation.approve') then
    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'exemption', 'id', e.id, 'ref', p.pun, 'title', e.kind || ' ' || e.pct || '%', 'detail', e.reason,
        'amount', null, 'by_id', e.requested_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = e.requested_by),
        'at', e.requested_at, 'href', '/valuation?tab=requests') x
        from public.exemptions e join public.parcels p on p.id = e.parcel_id
       where e.status = 'pending' and public.can_access_district(p.district_id)
       order by e.requested_at limit 200) t(x)), '[]'::jsonb);

    v_items := v_items || coalesce((select jsonb_agg(x order by x ->> 'at') from (
      select jsonb_build_object('kind', 'appeal', 'id', a.id, 'ref', p.pun, 'title', a.reason, 'detail', null,
        'amount', a.requested_total, 'by_id', a.filed_by, 'by', (select pr.full_name from public.profiles pr where pr.user_id = a.filed_by),
        'at', a.filed_at, 'href', '/valuation?tab=requests') x
        from public.appeals a join public.parcels p on p.id = a.parcel_id
       where a.status = 'open' and public.can_access_district(p.district_id)
       order by a.filed_at limit 200) t(x)), '[]'::jsonb);
  end if;

  return jsonb_build_object('items', (select coalesce(jsonb_agg(i || jsonb_build_object('mine', (i ->> 'by_id') = v_uid::text)), '[]'::jsonb)
                                         from jsonb_array_elements(v_items) i));
end;
$$;
revoke all on function public.approvals_inbox() from public, anon;
grant execute on function public.approvals_inbox() to authenticated;

-- Approve or turn down one item from the Applications page: each kind goes to its own approval step, which checks
-- the power, the district and maker-checker as before.
create or replace function public.approval_decide(p_kind text, p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_out jsonb;
begin
  if not p_approve and p_kind in ('land_register', 'owner', 'certificate_issue', 'shift', 'billing_run', 'appeal') then
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
    when 'cashier_recon' then perform public.cashier_recon_decide(p_id, p_approve, v_note);
    when 'movement' then perform public.movement_decide(p_id, p_approve, v_note);
    when 'exemption' then perform public.exemption_decide(p_id, p_approve, v_note);
    when 'appeal' then perform private.raise_app_error('CONFLICT', 'open_to_decide');
    else perform private.raise_app_error('VALIDATION', 'kind');
  end case;
  return coalesce(v_out, 'null'::jsonb);
end;
$$;
revoke all on function public.approval_decide(text, uuid, boolean, text) from public, anon;
grant execute on function public.approval_decide(text, uuid, boolean, text) to authenticated;
