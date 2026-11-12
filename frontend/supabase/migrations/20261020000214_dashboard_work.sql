-- Dashboard → "My work": one panel per job the signed-in user does (by their powers, so per role and per user),
-- each with the counts that need them now. Only what the user may see, in their districts.

create or replace function public.dashboard_work()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  v_today timestamptz := date_trunc('day', now());
  v_month_open boolean;
begin
  if v_uid is null or not public.has_permission('dashboard.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'dashboard');
  end if;

  -- A surveyor's own work.
  if public.has_permission('surveys.create') and not public.has_permission('surveys.approve') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'surveyor', 'items', jsonb_build_array(
      jsonb_build_object('key', 'my_zones', 'n', (select count(*) from public.survey_zones where surveyor_id = v_uid and status = 'open')),
      jsonb_build_object('key', 'my_site_checks', 'n', (select count(*) from public.applications where site_check_surveyor = v_uid and site_check_status = 'pending')),
      jsonb_build_object('key', 'my_surveys', 'n', (select count(*) from public.surveys where surveyor_id = v_uid and status in ('assigned', 'in_progress', 'returned'))))));
  end if;

  -- Whoever runs the surveyors.
  if public.has_permission('surveys.approve') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'surveys', 'items', jsonb_build_array(
      jsonb_build_object('key', 'zones_open', 'n', (select count(*) from public.survey_zones where status = 'open' and public.can_access_district(district_id))),
      jsonb_build_object('key', 'surveys_to_review', 'n', (select count(*) from public.surveys s join public.applications a on a.id = s.application_id
                                                             where s.status in ('submitted', 'overlap_review') and public.can_access_district(a.district_id))),
      jsonb_build_object('key', 'site_checks', 'n', (select count(*) from public.applications where site_check_status = 'pending' and public.can_access_district(district_id))))));
  end if;

  -- Registration: land waiting to be checked and registered, changes and demolitions to decide.
  if public.has_permission('parcels.approve') or public.has_permission('applications.approve') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'registration', 'items', jsonb_build_array(
      jsonb_build_object('key', 'partial_land', 'n', (select count(*) from public.parcels where deleted_at is null and status in ('draft', 'surveyed') and public.can_access_district(district_id))),
      jsonb_build_object('key', 'ready_to_register', 'n', (select count(*) from public.parcels where deleted_at is null and status = 'verified' and public.can_access_district(district_id))),
      jsonb_build_object('key', 'changes', 'n', (select count(*) from public.parcel_changes where status = 'submitted' and requested_by is distinct from v_uid and public.can_access_district(district_id))),
      jsonb_build_object('key', 'demolitions', 'n', case when public.has_permission('parcels.demolish_approve')
        then (select count(*) from public.demolitions where status = 'pending' and public.can_access_district(district_id)) else 0 end))));
  end if;

  -- The cashier's desk.
  if public.has_permission('cashier.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'cashier', 'items', jsonb_build_array(
      jsonb_build_object('key', 'shift_open', 'n', (select count(*) from public.cashier_shifts where cashier_id = v_uid and status = 'open')),
      jsonb_build_object('key', 'taken_today', 'n', (select count(*) from public.payments where created_by = v_uid and status <> 'reversed' and received_at >= v_today),
                         'amount', (select coalesce(sum(amount_base), 0) from public.payments where created_by = v_uid and status <> 'reversed' and received_at >= v_today)),
      jsonb_build_object('key', 'houses_owing', 'n', (select count(distinct i.parcel_id) from public.invoices i join public.parcels p on p.id = i.parcel_id
                                                        where i.status in ('issued', 'partially_paid') and i.balance > 0 and p.deleted_at is null
                                                          and p.status in ('registered', 'disputed') and public.can_access_district(i.district_id))))));
  end if;

  -- Approving the money cashiers and online payments took.
  if public.has_permission('payments.approve') or public.has_permission('reconciliation.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'collections', 'items', jsonb_build_array(
      jsonb_build_object('key', 'waiting_approval', 'n', (select count(*) from public.payments where verify_status = 'pending' and status <> 'reversed' and private.can_view_payment(district_id, parcel_id)),
                         'amount', (select coalesce(sum(amount_base), 0) from public.payments where verify_status = 'pending' and status <> 'reversed' and private.can_view_payment(district_id, parcel_id))),
      jsonb_build_object('key', 'disputed', 'n', (select count(*) from public.payments where verify_status = 'disputed' and status <> 'reversed' and private.can_view_payment(district_id, parcel_id))),
      jsonb_build_object('key', 'collected_today', 'n', (select count(*) from public.payments where status <> 'reversed' and received_at >= v_today and private.can_view_payment(district_id, parcel_id)),
                         'amount', (select coalesce(sum(amount_base), 0) from public.payments where status <> 'reversed' and received_at >= v_today and private.can_view_payment(district_id, parcel_id))))));
  end if;

  -- Bills.
  if public.has_permission('invoices.view') or public.has_permission('billing.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'billing', 'items', jsonb_build_array(
      jsonb_build_object('key', 'overdue', 'n', (select count(*) from public.invoices where status in ('issued', 'partially_paid') and due_date < current_date and public.can_access_district(district_id)),
                         'amount', (select coalesce(sum(balance), 0) from public.invoices where status in ('issued', 'partially_paid') and due_date < current_date and public.can_access_district(district_id))),
      jsonb_build_object('key', 'runs_waiting', 'n', case when public.has_permission('billing.approve')
        then (select count(*) from public.billing_runs where status = 'submitted' and created_by is distinct from v_uid) else 0 end))));
  end if;

  -- Valuation requests.
  if public.has_permission('valuation.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'valuation', 'items', jsonb_build_array(
      jsonb_build_object('key', 'exemptions', 'n', (select count(*) from public.exemptions e join public.parcels p on p.id = e.parcel_id where e.status = 'pending' and public.can_access_district(p.district_id))),
      jsonb_build_object('key', 'appeals', 'n', (select count(*) from public.appeals ap join public.assessments s on s.id = ap.assessment_id join public.parcels p on p.id = s.parcel_id
                                                  where ap.status = 'open' and public.can_access_district(p.district_id))))));
  end if;

  -- Legal: transfers, disputes and permits.
  if public.has_permission('transfers.view') or public.has_permission('disputes.view') or public.has_permission('permits.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'legal', 'items', jsonb_build_array(
      jsonb_build_object('key', 'transfers', 'n', (select count(*) from public.transfers where status = 'submitted' and public.can_access_district(district_id))),
      jsonb_build_object('key', 'transfer_drafts', 'n', (select count(*) from public.transfers where status = 'draft' and created_by = v_uid)),
      jsonb_build_object('key', 'disputes', 'n', (select count(*) from public.disputes where status = 'open' and public.can_access_district(district_id))),
      jsonb_build_object('key', 'permits', 'n', (select count(*) from public.permits where status = 'submitted' and public.can_access_district(district_id))))));
  end if;

  -- Accounting.
  if public.has_permission('accounting.view') then
    select coalesce((select status = 'open' from public.fiscal_periods
                      where year = extract(year from current_date)::int and month = extract(month from current_date)::int), true) into v_month_open;
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'accounting', 'month_open', v_month_open, 'items', jsonb_build_array(
      jsonb_build_object('key', 'movements_pending', 'n', (select count(*) from public.money_movements where status = 'pending' and (district_id is null or public.can_access_district(district_id)))),
      jsonb_build_object('key', 'entries_month', 'n', (select count(*) from public.journal_entries where entry_date >= date_trunc('month', current_date))))));
  end if;

  -- Printing certificates and ID cards.
  if public.has_permission('documents.print') or public.has_permission('certificates.print') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'printing', 'items', jsonb_build_array(
      jsonb_build_object('key', 'print_queue', 'n', (select count(*) from public.printer_queue where status in ('queued', 'printing', 'failed'))),
      jsonb_build_object('key', 'reprints', 'n', case when public.has_permission('certificates.reprint') or public.has_permission('documents.approve')
        then (select count(*) from public.reprint_requests where status = 'pending') else 0 end))));
  end if;

  -- People and access.
  if public.has_permission('users.view') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('panel', 'admin', 'items', jsonb_build_array(
      jsonb_build_object('key', 'invited', 'n', (select count(*) from public.profiles where kind = 'staff' and status = 'invited' and deleted_at is null)),
      jsonb_build_object('key', 'suspended', 'n', (select count(*) from public.profiles where kind = 'staff' and status = 'suspended' and deleted_at is null)),
      jsonb_build_object('key', 'active', 'n', (select count(*) from public.profiles where kind = 'staff' and status = 'active' and deleted_at is null)))));
  end if;

  return v_out;
end;
$$;
revoke all on function public.dashboard_work() from public, anon;
grant execute on function public.dashboard_work() to authenticated;
