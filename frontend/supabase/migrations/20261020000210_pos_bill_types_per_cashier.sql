-- Collections → Point of sale: the money by bill type for each cashier's row too (the table shows a column per bill
-- type), and no "left over (credit)" line — only what went on bills.

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
    select c.id as place_id, p.id as payment_id, p.pos_id, p.created_by as cashier_id, p.amount_base as amount, p.verify_status,
           private.collection_channel(p.method, p.wallet) as channel,
           (c.district_id is not null and p.pos_id in (select id from online)) as is_online
      from candidates c
      join public.payments p
        on p.pos_id = c.id
        or (c.district_id is not null and c.is_main and p.district_id = c.district_id and p.pos_id in (select id from online))
     where p.status <> 'reversed'
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
  ), kinds as (
    -- What each payment paid for: its share on each bill, by the bill's type.
    select x.place_id, x.cashier_id, x.is_online, x.pos_id, f.code, f.name_so, f.name_en, f.sort, a.amount
      from pays x
      join public.payment_allocations a on a.payment_id = x.payment_id
      join public.invoices i on i.id = a.invoice_id
      join public.fee_types f on f.id = i.fee_type_id
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
      'bill_types', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name_so', k.name_so, 'name_en', k.name_en, 'total', k.total) order by k.sort, k.code)
                                from (select code, min(name_so) as name_so, min(name_en) as name_en, min(sort) as sort, sum(amount) as total
                                        from kinds where kinds.place_id = pl.id group by code) k), '[]'::jsonb),
      'cashiers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cashier_id', c.cashier_id, 'cashier', pr.full_name, 'online', c.is_online, 'pos_id', c.pos_id,
                 'payments', c.payments, 'total', c.total, 'approved', c.approved, 'waiting', c.waiting,
                 'waiting_count', c.waiting_count, 'disputed', c.disputed,
                 'channels', coalesce((select jsonb_object_agg(channel, total)
                                         from (select channel, sum(amount) as total from pays x
                                                where x.place_id = pl.id and x.cashier_id is not distinct from c.cashier_id
                                                  and x.is_online = c.is_online and x.pos_id = c.pos_id
                                                group by channel) ch), '{}'::jsonb),
                 'bill_types', coalesce((select jsonb_object_agg(code, total)
                                           from (select code, sum(amount) as total from kinds k
                                                  where k.place_id = pl.id and k.cashier_id is not distinct from c.cashier_id
                                                    and k.is_online = c.is_online and k.pos_id = c.pos_id
                                                  group by code) bt), '{}'::jsonb))
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


