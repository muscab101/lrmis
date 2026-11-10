-- Cashier days show the point(s) of sale each cashier took the money at, and can be narrowed to one point of sale (the
-- days on which the cashier took payments there). The day's figures stay the cashier's whole day, as reconciled.

drop function if exists public.cashier_days(date, date);

create function public.cashier_days(p_from date, p_to date, p_pos uuid default null)
returns table (cashier_id uuid, cashier text, business_date date, district_id uuid, pos_names text, payments bigint, recorded numeric,
               pending bigint, verified bigint, disputed bigint, reconciliation_id uuid, number text, status text, actual numeric,
               difference numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  perform private.assert_report(p_from, p_to);
  return query
    with d as (
      select p.created_by, (p.received_at at time zone 'UTC')::date bd, min(p.district_id::text)::uuid district_id, count(*) n, sum(p.amount_base) amt,
             count(*) filter (where p.verify_status = 'pending') pend,
             count(*) filter (where p.verify_status in ('verified', 'reconciled')) ver,
             count(*) filter (where p.verify_status = 'disputed') dis,
             array_agg(distinct p.pos_id) filter (where p.pos_id is not null) pos_ids
        from public.payments p
       where p.status <> 'reversed' and p.created_by is not null and p.received_at >= p_from and p.received_at < p_to + 1
         and private.can_view_payment(p.district_id, p.parcel_id)
       group by 1, 2
    )
    select d.created_by, pr.full_name, d.bd, d.district_id,
           (select string_agg(s.code || ' ' || s.name, ', ' order by s.code) from public.points_of_sale s where s.id = any (d.pos_ids)),
           d.n, d.amt, d.pend, d.ver, d.dis,
           r.id, r.number, r.status, r.actual, r.difference
      from d
      left join public.profiles pr on pr.user_id = d.created_by
      left join lateral (select * from public.cashier_reconciliations x where x.cashier_id = d.created_by and x.business_date = d.bd
                          order by (x.status <> 'rejected') desc, x.prepared_at desc limit 1) r on true
     where p_pos is null or p_pos = any (d.pos_ids)
     order by d.bd desc, pr.full_name;
end;
$$;
revoke all on function public.cashier_days(date, date, uuid) from public, anon;
grant execute on function public.cashier_days(date, date, uuid) to authenticated;
