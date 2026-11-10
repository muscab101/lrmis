-- A district office's account also shows that district's online payments (paid by mobile money or card through the
-- portal, the pay link, USSD or WhatsApp): its cashiers first, then "Online payments" for land in that district.
-- Approving that row approves only that district's online payments. When a district has several offices, its online
-- payments show under its main office only (the first by code), so they are never counted twice. Choosing "Online
-- payments" itself still shows every district's online money together.

drop function if exists public.collections_by_pos(date, date, uuid);

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
  with online as (
    -- The points of sale with no district: online payments.
    select s.id from public.points_of_sale s where s.district_id is null
  ), candidates as (
    select s.id, s.code, s.name, s.district_id, d.name_so as district_so, d.name_en as district_en,
           s.id = (select m.id from public.points_of_sale m where m.district_id = s.district_id and m.active order by m.code limit 1) as is_main
      from public.points_of_sale s
      left join public.districts d on d.id = s.district_id
     where (s.district_id is null or public.can_access_district(s.district_id))
       and (p_pos is null or s.id = p_pos)
  ), pays as (
    -- Each office's own payments, and (for a district office) the online payments for land in its district.
    select c.id as place_id, p.pos_id, p.created_by as cashier_id, p.amount_base as amount, p.verify_status,
           (c.district_id is not null and p.pos_id in (select id from online)) as is_online
      from candidates c
      join public.payments p
        on p.pos_id = c.id
        or (c.district_id is not null and c.is_main and p.district_id = c.district_id and p.pos_id in (select id from online))
     where p.status <> 'reversed'
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
  ), places as (
    select c.* from candidates c where p_pos is not null or exists (select 1 from pays where pays.place_id = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'code', pl.code, 'name', pl.name, 'district_id', pl.district_id,
      'district_so', pl.district_so, 'district_en', pl.district_en,
      'payments', (select count(*) from pays where pays.place_id = pl.id),
      'total', (select coalesce(sum(amount), 0) from pays where pays.place_id = pl.id),
      'approved', (select coalesce(sum(amount), 0) from pays where pays.place_id = pl.id and verify_status in ('verified', 'reconciled')),
      'waiting', (select coalesce(sum(amount), 0) from pays where pays.place_id = pl.id and verify_status = 'pending'),
      'disputed', (select coalesce(sum(amount), 0) from pays where pays.place_id = pl.id and verify_status = 'disputed'),
      'cashiers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cashier_id', c.cashier_id, 'cashier', pr.full_name, 'online', c.is_online, 'pos_id', c.pos_id,
                 'payments', c.payments, 'total', c.total, 'approved', c.approved, 'waiting', c.waiting,
                 'waiting_count', c.waiting_count, 'disputed', c.disputed)
               order by c.is_online, c.waiting desc, pr.full_name)
          from (select cashier_id, is_online, pos_id, count(*) as payments, sum(amount) as total,
                       coalesce(sum(amount) filter (where verify_status in ('verified', 'reconciled')), 0) as approved,
                       coalesce(sum(amount) filter (where verify_status = 'pending'), 0) as waiting,
                       count(*) filter (where verify_status = 'pending') as waiting_count,
                       coalesce(sum(amount) filter (where verify_status = 'disputed'), 0) as disputed
                  from pays where pays.place_id = pl.id group by cashier_id, is_online, pos_id) c
          left join public.profiles pr on pr.user_id = c.cashier_id), '[]'::jsonb)
    ) order by pl.code), '[]'::jsonb)
    into v
    from places pl;
  return v;
end;
$$;
revoke all on function public.collections_by_pos(date, date, uuid) from public, anon;
grant execute on function public.collections_by_pos(date, date, uuid) to authenticated;

-- Approve one cashier's waiting payments at one point of sale; for online payments shown under a district office,
-- only those for land in that district (p_district).
drop function if exists public.pos_cashier_approve(uuid, uuid, date, date);

create function public.pos_cashier_approve(p_pos uuid, p_cashier uuid, p_from date, p_to date, p_district uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_n int := 0;
  v_i int := 1;
begin
  perform private.assert_permission('reconciliation.update');
  perform private.assert_report(p_from, p_to);
  select array_agg(p.id order by p.received_at) into v_ids
    from public.payments p
   where p.pos_id = p_pos and p.created_by = p_cashier and p.status <> 'reversed' and p.verify_status = 'pending'
     and (p_district is null or p.district_id = p_district)
     and p.received_at >= p_from and p.received_at < p_to + 1
     and private.can_view_payment(p.district_id, p.parcel_id);
  if v_ids is null then
    perform private.raise_app_error('CONFLICT', 'nothing_to_approve');
  end if;
  -- payment_verify takes at most 500 at a time.
  while v_i <= cardinality(v_ids) loop
    v_n := v_n + public.payment_verify(v_ids[v_i : v_i + 499], null);
    v_i := v_i + 500;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.pos_cashier_approve(uuid, uuid, date, date, uuid) from public, anon;
grant execute on function public.pos_cashier_approve(uuid, uuid, date, date, uuid) to authenticated;
