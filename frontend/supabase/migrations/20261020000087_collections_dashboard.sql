-- Collections, stage 5: the figures for the collections dashboard in one call. Today, this week (from Monday) and
-- this month, everything recorded and the verified part; this month per way of paying; how many payments are
-- pending, verified, reconciled and disputed; shortages and excess from cashier reconciliations; what waits for a
-- decision.
create or replace function public.collections_dashboard(p_district uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := current_date;
  v_week date := date_trunc('week', current_date)::date;
  v_month date := date_trunc('month', current_date)::date;
  v jsonb;
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  with m as (
    select * from private.collection_rows(v_month, v_today, 'all', p_district, null, null, null)
  )
  select jsonb_build_object(
    'today', jsonb_build_object('all', coalesce(sum(m.amount) filter (where m.received_at >= v_today), 0),
                                'verified', coalesce(sum(m.amount) filter (where m.received_at >= v_today and m.verify_status in ('verified', 'reconciled')), 0),
                                'n', count(*) filter (where m.received_at >= v_today)),
    'month', jsonb_build_object('all', coalesce(sum(m.amount), 0),
                                'verified', coalesce(sum(m.amount) filter (where m.verify_status in ('verified', 'reconciled')), 0),
                                'n', count(*)),
    'channels', (select coalesce(jsonb_object_agg(c, a), '{}'::jsonb) from (select m2.channel c, sum(m2.amount) a from m m2 group by 1) x),
    'status', (select coalesce(jsonb_object_agg(s, jsonb_build_object('n', n, 'amount', a)), '{}'::jsonb)
                 from (select m3.verify_status s, count(*) n, sum(m3.amount) a from m m3 group by 1) y))
    into v
    from m;
  -- The week can start in the previous month.
  v := v || jsonb_build_object('week', (
    select jsonb_build_object('all', coalesce(sum(w.amount), 0),
                              'verified', coalesce(sum(w.amount) filter (where w.verify_status in ('verified', 'reconciled')), 0),
                              'n', count(*))
      from private.collection_rows(v_week, v_today, 'all', p_district, null, null, null) w));
  v := v || (
    select jsonb_build_object('shortage', coalesce(sum(l.shortage), 0), 'excess', coalesce(sum(l.excess), 0))
      from public.cashier_reconciliations c join public.cashier_reconciliation_lines l on l.reconciliation_id = c.id
     where c.status <> 'rejected' and c.business_date between v_month and v_today
       and (c.district_id is null or public.can_access_district(c.district_id)) and (p_district is null or c.district_id = p_district));
  v := v || jsonb_build_object(
    'recon_waiting', (select count(*) from public.cashier_reconciliations c where c.status = 'submitted'
                        and (c.district_id is null or public.can_access_district(c.district_id)) and (p_district is null or c.district_id = p_district)),
    'corrections_waiting', (select count(*) from public.payment_corrections pc join public.payments p on p.id = pc.payment_id
                             where pc.status = 'pending' and private.can_view_payment(p.district_id, p.parcel_id)
                               and (p_district is null or p.district_id = p_district)),
    'week_from', v_week, 'month_from', v_month, 'as_of', v_today);
  return v;
end;
$$;

revoke all on function public.collections_dashboard(uuid) from public, anon;
grant execute on function public.collections_dashboard(uuid) to authenticated;
