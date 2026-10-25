-- ============================================================================
-- 0110 The modern dashboard: figures for a period with the period before.
--
-- dashboard_period(p_days) returns, for the last p_days (7–365) and the same
-- length before it: applications submitted, land registered, money collected
-- and billed, owners added; a daily trend of collected / billed; collected by
-- fee type; applications by weekday; the collection rate; the top districts by
-- collection; and the latest applications. Same rules as dashboard_kpis: each
-- part needs its permission and only the caller's districts count.
-- "Waiting for me" now also counts transfers the caller started (0109).
-- ============================================================================

create function public.dashboard_period(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_to date := current_date;
  v_from date := current_date - (v_days - 1);
  v_pfrom date := current_date - (2 * v_days - 1);
  v_pto date := current_date - v_days;
  v_fin boolean := public.has_permission('reports.view') or public.has_permission('invoices.view') or public.has_permission('payments.view');
  v_apps boolean := public.has_permission('applications.view') or public.has_permission('reports.view');
  v_out jsonb;
begin
  if auth.uid() is null or not public.has_permission('dashboard.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'dashboard');
  end if;
  v_out := jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'prev_from', v_pfrom, 'prev_to', v_pto);

  if v_apps then
    v_out := v_out || jsonb_build_object(
      'applications', (select jsonb_build_object(
          'cur', count(*) filter (where submitted_at::date between v_from and v_to),
          'prev', count(*) filter (where submitted_at::date between v_pfrom and v_pto))
        from public.applications where public.can_access_district(district_id)),
      'weekday', (select coalesce(jsonb_agg(coalesce(x.n, 0) order by d), '[]'::jsonb)
        from generate_series(1, 7) d
        left join (select extract(isodow from submitted_at)::int dw, count(*) n from public.applications
                    where submitted_at::date between v_from and v_to and public.can_access_district(district_id) group by 1) x on x.dw = d),
      'recent', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
          select a.id, a.number, a.status, a.created_at,
                 (select d.name_en from public.districts d where d.id = a.district_id) as district_en,
                 (select d.name_so from public.districts d where d.id = a.district_id) as district_so,
                 (select string_agg(pa.full_name, ', ') from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                   where ap.application_id = a.id and ap.role in ('owner', 'co_owner')) as owners
            from public.applications a where public.can_access_district(a.district_id)
           order by a.created_at desc limit 6) r));
  end if;

  if public.has_permission('parcels.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('registered', (select jsonb_build_object(
        'cur', count(*) filter (where registered_at::date between v_from and v_to),
        'prev', count(*) filter (where registered_at::date between v_pfrom and v_pto),
        'total', count(*) filter (where status in ('registered', 'disputed')))
      from public.parcels where deleted_at is null and public.can_access_district(district_id)));
  end if;

  if public.has_permission('owners.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('owners', (select jsonb_build_object(
        'cur', count(*) filter (where created_at::date between v_from and v_to),
        'prev', count(*) filter (where created_at::date between v_pfrom and v_pto),
        'total', count(*))
      from public.parties where deleted_at is null and (district_id is null or public.can_access_district(district_id))));
  end if;

  if v_fin then
    v_out := v_out || jsonb_build_object(
      'collected', (select jsonb_build_object(
          'cur', coalesce(sum(amount_base) filter (where received_at::date between v_from and v_to), 0),
          'prev', coalesce(sum(amount_base) filter (where received_at::date between v_pfrom and v_pto), 0))
        from public.payments where status = 'completed' and (district_id is null or public.can_access_district(district_id))),
      'billed', (select jsonb_build_object(
          'cur', coalesce(sum(total) filter (where issue_date between v_from and v_to), 0),
          'prev', coalesce(sum(total) filter (where issue_date between v_pfrom and v_pto), 0),
          'paid_cur', coalesce(sum(paid + credited) filter (where issue_date between v_from and v_to), 0),
          'outstanding', coalesce(sum(balance) filter (where status in ('issued', 'partially_paid')), 0))
        from public.invoices where status <> 'cancelled' and public.can_access_district(district_id)),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'collected', coalesce(c.amount, 0), 'billed', coalesce(b.amount, 0)) order by d), '[]'::jsonb)
        from generate_series(v_from, v_to, interval '1 day') d
        left join (select received_at::date dd, sum(amount_base) amount from public.payments
                    where status = 'completed' and received_at::date between v_from and v_to
                      and (district_id is null or public.can_access_district(district_id)) group by 1) c on c.dd = d::date
        left join (select issue_date dd, sum(total) amount from public.invoices
                    where status <> 'cancelled' and issue_date between v_from and v_to and public.can_access_district(district_id) group by 1) b on b.dd = d::date),
      'by_fee', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_en', name_en, 'name_so', name_so, 'amount', amount) order by amount desc), '[]'::jsonb) from (
          select f.code, f.name_en, f.name_so, sum(al.amount) amount
            from public.payment_allocations al
            join public.payments p on p.id = al.payment_id and p.status = 'completed' and p.received_at::date between v_from and v_to
            join public.invoices i on i.id = al.invoice_id
            join public.fee_types f on f.id = i.fee_type_id
           where public.can_access_district(i.district_id)
           group by 1, 2, 3) x),
      'districts', (select coalesce(jsonb_agg(jsonb_build_object('name_en', name_en, 'name_so', name_so, 'amount', amount) order by amount desc), '[]'::jsonb) from (
          select d.name_en, d.name_so, sum(p.amount_base) amount
            from public.payments p join public.districts d on d.id = p.district_id
           where p.status = 'completed' and p.received_at::date between v_from and v_to and public.can_access_district(p.district_id)
           group by 1, 2 order by 3 desc limit 5) x));
  end if;
  return v_out;
end;
$$;
revoke all on function public.dashboard_period(int) from public, anon;
grant execute on function public.dashboard_period(int) to authenticated;

create or replace function public.dashboard_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_month date := date_trunc('month', current_date)::date;
  v_year date := date_trunc('year', current_date)::date;
  v_fin boolean := public.has_permission('reports.view') or public.has_permission('invoices.view') or public.has_permission('payments.view');
begin
  if v_uid is null or not public.has_permission('dashboard.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'dashboard');
  end if;

  if public.has_permission('applications.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('applications', (
      select jsonb_build_object(
        'open', count(*) filter (where status not in ('draft', 'approved', 'rejected', 'cancelled')),
        'submitted_month', count(*) filter (where submitted_at >= v_month),
        'by_status', coalesce((select jsonb_object_agg(s, n) from (
            select status::text s, count(*) n from public.applications a2
             where public.can_access_district(a2.district_id) and status not in ('draft', 'cancelled') group by 1) x), '{}'::jsonb))
        from public.applications a where public.can_access_district(a.district_id)));
  end if;

  if public.has_permission('parcels.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('parcels', (
      select jsonb_build_object(
        'registered', count(*) filter (where status in ('registered', 'disputed')),
        'registered_month', count(*) filter (where registered_at >= v_month),
        'disputed', count(*) filter (where status = 'disputed'),
        'area_ha', round(coalesce(sum(area_m2) filter (where status in ('registered', 'disputed')), 0) / 10000, 1))
        from public.parcels p where p.deleted_at is null and public.can_access_district(p.district_id)));
  end if;

  if v_fin then
    v_out := v_out || jsonb_build_object('finance', jsonb_build_object(
      'collected_month', (select coalesce(sum(amount_base), 0) from public.payments
                           where status = 'completed' and received_at >= v_month and (district_id is null or public.can_access_district(district_id))),
      'collected_year', (select coalesce(sum(amount_base), 0) from public.payments
                          where status = 'completed' and received_at >= v_year and (district_id is null or public.can_access_district(district_id))),
      'outstanding', (select coalesce(sum(balance), 0) from public.invoices
                       where status in ('issued', 'partially_paid') and public.can_access_district(district_id)),
      'overdue', (select coalesce(sum(balance), 0) from public.invoices
                   where status in ('issued', 'partially_paid') and due_date < current_date and public.can_access_district(district_id)),
      'billed_year', (select coalesce(sum(total), 0) from public.invoices
                       where status <> 'cancelled' and issue_date >= v_year and public.can_access_district(district_id)),
      'paid_year', (select coalesce(sum(paid + credited), 0) from public.invoices
                     where status <> 'cancelled' and issue_date >= v_year and public.can_access_district(district_id)),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'amount', coalesce(x.amount, 0)) order by m), '[]'::jsonb)
                  from generate_series(v_month - interval '5 months', v_month, interval '1 month') m
                  left join (select date_trunc('month', received_at) mm, sum(amount_base) amount from public.payments
                              where status = 'completed' and received_at >= v_month - interval '5 months'
                                and (district_id is null or public.can_access_district(district_id)) group by 1) x on x.mm = m)));
  end if;

  -- What is waiting for me. Items I created myself are excluded where a second person must decide
  -- (transfers no longer need a second person: 0109).
  v_out := v_out || jsonb_build_object('tasks', jsonb_build_object(
    'surveys', (select count(*) from public.surveys where surveyor_id = v_uid and status in ('assigned', 'in_progress', 'returned')),
    'transfers', case when public.has_permission('transfers.approve') then
        (select count(*) from public.transfers where status = 'submitted' and public.can_access_district(district_id)) else 0 end,
    'permits', case when public.has_permission('permits.approve') then
        (select count(*) from public.permits where status = 'submitted' and requested_by is distinct from v_uid and public.can_access_district(district_id)) else 0 end,
    'changes', case when public.has_permission('parcels.approve') then
        (select count(*) from public.parcel_changes where status = 'submitted' and requested_by is distinct from v_uid and public.can_access_district(district_id)) else 0 end,
    'disputes', case when public.has_permission('disputes.approve') then
        (select count(*) from public.disputes where status = 'open' and public.can_access_district(district_id)) else 0 end,
    'campaigns', case when public.has_permission('messages.approve') then
        (select count(*) from public.message_campaigns where status = 'draft' and created_by is distinct from v_uid) else 0 end,
    'messages_failed', case when public.has_permission('messages.view') then
        (select count(*) from public.messages where status = 'failed' and (district_id is null or public.can_access_district(district_id))) else 0 end));
  return v_out;
end;
$$;
