-- Collections by point of sale: pick one point of sale from a list (every point of sale in your districts, with Online
-- payments) instead of typing a search. A chosen point of sale is shown even when it took nothing in the dates.

drop function if exists public.collections_by_pos(date, date, text);

create function public.collections_by_pos(p_from date, p_to date, p_pos uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  perform private.assert_report(p_from, p_to);
  with pays as (
    select p.pos_id, p.created_by as cashier_id, p.amount_base as amount, p.verify_status
      from public.payments p
     where p.status <> 'reversed' and p.pos_id is not null
       and (p_pos is null or p.pos_id = p_pos)
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
  ), places as (
    select s.id, s.code, s.name, d.name_so as district_so, d.name_en as district_en
      from public.points_of_sale s
      left join public.districts d on d.id = s.district_id
     where (s.district_id is null or public.can_access_district(s.district_id))
       and (case when p_pos is not null then s.id = p_pos else exists (select 1 from pays where pays.pos_id = s.id) end)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'code', pl.code, 'name', pl.name, 'district_so', pl.district_so, 'district_en', pl.district_en,
      'payments', (select count(*) from pays where pays.pos_id = pl.id),
      'total', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id),
      'approved', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status in ('verified', 'reconciled')),
      'waiting', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status = 'pending'),
      'disputed', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status = 'disputed'),
      'cashiers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cashier_id', c.cashier_id, 'cashier', pr.full_name, 'payments', c.payments, 'total', c.total,
                 'approved', c.approved, 'waiting', c.waiting, 'waiting_count', c.waiting_count, 'disputed', c.disputed)
               order by c.waiting desc, pr.full_name)
          from (select cashier_id, count(*) as payments, sum(amount) as total,
                       coalesce(sum(amount) filter (where verify_status in ('verified', 'reconciled')), 0) as approved,
                       coalesce(sum(amount) filter (where verify_status = 'pending'), 0) as waiting,
                       count(*) filter (where verify_status = 'pending') as waiting_count,
                       coalesce(sum(amount) filter (where verify_status = 'disputed'), 0) as disputed
                  from pays where pays.pos_id = pl.id group by cashier_id) c
          left join public.profiles pr on pr.user_id = c.cashier_id), '[]'::jsonb)
    ) order by pl.code), '[]'::jsonb)
    into v
    from places pl;
  return v;
end;
$$;
revoke all on function public.collections_by_pos(date, date, uuid) from public, anon;
grant execute on function public.collections_by_pos(date, date, uuid) to authenticated;

-- The points of sale to choose from: those in your districts, and the ones without a district (Online payments).
create or replace function public.collections_pos_choices()
returns table (id uuid, code text, name text, district_so text, district_en text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  return query
    select s.id, s.code, s.name, d.name_so, d.name_en
      from public.points_of_sale s
      left join public.districts d on d.id = s.district_id
     where s.active and (s.district_id is null or public.can_access_district(s.district_id))
     order by d.name_en nulls last, s.code;
end;
$$;
revoke all on function public.collections_pos_choices() from public, anon;
grant execute on function public.collections_pos_choices() to authenticated;
