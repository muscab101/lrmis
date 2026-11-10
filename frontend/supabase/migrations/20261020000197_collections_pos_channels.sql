-- Collections by point of sale, part 3: the money by way of paying (cash, EVC Plus, eDahab, ZAAD, bank, card) for each
-- office and each cashier, and the payments behind a row for its "View" window.

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
           private.collection_channel(p.method, p.wallet) as channel,
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
      'channels', coalesce((select jsonb_object_agg(channel, total) from (select channel, sum(amount) as total from pays where pays.place_id = pl.id group by channel) ch), '{}'::jsonb),
      'cashiers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cashier_id', c.cashier_id, 'cashier', pr.full_name, 'online', c.is_online, 'pos_id', c.pos_id,
                 'payments', c.payments, 'total', c.total, 'approved', c.approved, 'waiting', c.waiting,
                 'waiting_count', c.waiting_count, 'disputed', c.disputed,
                 'channels', coalesce((select jsonb_object_agg(channel, total)
                                         from (select channel, sum(amount) as total from pays x
                                                where x.place_id = pl.id and x.cashier_id is not distinct from c.cashier_id
                                                  and x.is_online = c.is_online and x.pos_id = c.pos_id
                                                group by channel) ch), '{}'::jsonb))
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

-- The payments behind one row of an office's account: one cashier's (or the system's, for citizens paying online
-- themselves) at one point of sale in the period; for a district's online row, only that district's.
create or replace function public.pos_cashier_payments(p_pos uuid, p_cashier uuid, p_from date, p_to date, p_district uuid default null)
returns table (payment_id uuid, receipt_no text, received_at timestamptz, channel text, reference text, amount numeric,
               pun text, house_no text, neighbourhood text, payer text, payer_phone text, verify_status text, verified_by text, verified_at timestamptz)
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
    select p.id, p.receipt_no, p.received_at, private.collection_channel(p.method, p.wallet), coalesce(p.reference, p.provider_ref),
           p.amount_base, pa.pun, pa.house_no, n.code, p.payer_name, p.payer_phone, p.verify_status, vb.full_name, p.verified_at
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.neighbourhoods n on n.id = pa.neighbourhood_id
      left join public.profiles vb on vb.user_id = p.verified_by
     where p.pos_id = p_pos and p.created_by is not distinct from p_cashier and p.status <> 'reversed'
       and (p_district is null or p.district_id = p_district)
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
     order by p.received_at desc
     limit 1000;
end;
$$;
revoke all on function public.pos_cashier_payments(uuid, uuid, date, date, uuid) from public, anon;
grant execute on function public.pos_cashier_payments(uuid, uuid, date, date, uuid) to authenticated;
