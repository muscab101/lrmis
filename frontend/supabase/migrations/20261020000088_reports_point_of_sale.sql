-- Reports by point of sale: the money reports (payments, collections by period and by cashier, unreconciled, the
-- comparison and the verification facts) take a point of sale too, so a desk's own takings can be reported.
-- my_scope() tells the app which districts the signed-in user covers and which desk they are assigned to, so the
-- Locations page and the report filters only offer those.

/** The caller's districts (all or a list) and assigned point of sale. */
create or replace function public.my_scope()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'all', private.user_has_all_districts(auth.uid()),
    'district_ids', to_jsonb(private.user_district_ids(auth.uid())),
    'pos', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'district_id', s.district_id)
              from public.profiles p join public.points_of_sale s on s.id = p.point_of_sale_id where p.user_id = auth.uid()));
$$;
revoke all on function public.my_scope() from public, anon;
grant execute on function public.my_scope() to authenticated;

/** Payments in a period for the collections reports, with their column (channel). */
create or replace function private.collection_rows(p_from date, p_to date, p_basis text, p_district uuid,
                                                   p_section uuid, p_sector uuid, p_neighbourhood uuid, p_pos uuid)
returns table (id uuid, received_at timestamptz, created_by uuid, channel text, amount numeric, verify_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.received_at, p.created_by, private.collection_channel(p.method, p.wallet), p.amount_base, p.verify_status
    from public.payments p
    left join public.parcels pa on pa.id = p.parcel_id
   where p.status <> 'reversed' and p.received_at >= p_from and p.received_at < p_to + 1
     and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
     and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     and (coalesce(p_basis, 'verified') = 'all' or p.verify_status in ('verified', 'reconciled'))
     and (p_pos is null or p.pos_id = p_pos);
$$;

create or replace function private.collection_rows(p_from date, p_to date, p_basis text, p_district uuid,
                                                   p_section uuid, p_sector uuid, p_neighbourhood uuid)
returns table (id uuid, received_at timestamptz, created_by uuid, channel text, amount numeric, verify_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood, null::uuid);
$$;

drop function if exists public.report_collections(date, date, text, text, uuid, uuid, uuid, uuid);
drop function if exists public.report_collections_compare(date, date, text, uuid, uuid, uuid, uuid);
drop function if exists public.report_collections_cashier(date, date, text, uuid, uuid, uuid, uuid);
drop function if exists public.report_unreconciled(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.report_collections_status(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.report_payments(date, date, uuid, uuid, uuid, uuid, text, text);

/** Daily, weekly or monthly collections. */
create function public.report_collections(p_from date, p_to date, p_by text default 'day', p_basis text default 'verified',
                                                     p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                     p_neighbourhood uuid default null, p_pos uuid default null)
returns table (period date, period_end date, payments bigint, cash numeric, evc_plus numeric, edahab numeric, zaad numeric,
               bank_transfer numeric, card numeric, other numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  perform private.assert_basis(p_basis, p_by);
  return query
    with r as (select date_trunc(coalesce(p_by, 'day'), x.received_at)::date pd, x.* from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood, p_pos) x)
    select r.pd,
           least(case coalesce(p_by, 'day') when 'day' then r.pd when 'week' then r.pd + 6 else (r.pd + interval '1 month' - interval '1 day')::date end, p_to),
           count(*),
           coalesce(sum(r.amount) filter (where r.channel = 'cash'), 0), coalesce(sum(r.amount) filter (where r.channel = 'evc_plus'), 0),
           coalesce(sum(r.amount) filter (where r.channel = 'edahab'), 0), coalesce(sum(r.amount) filter (where r.channel = 'zaad'), 0),
           coalesce(sum(r.amount) filter (where r.channel = 'bank_transfer'), 0), coalesce(sum(r.amount) filter (where r.channel = 'card'), 0),
           coalesce(sum(r.amount) filter (where r.channel = 'other'), 0), sum(r.amount)
      from r group by r.pd order by r.pd;
end;
$$;

grant execute on function public.report_collections(date, date, text, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.report_collections(date, date, text, text, uuid, uuid, uuid, uuid, uuid) from public, anon;

/** Totals per column for the period and the period of the same length just before it. */
create function public.report_collections_compare(p_from date, p_to date, p_basis text default 'verified',
                                                             p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                             p_neighbourhood uuid default null, p_pos uuid default null)
returns table (channel text, current_amount numeric, previous_amount numeric, current_count bigint, previous_count bigint, previous_from date, previous_to date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := p_to - p_from + 1;
begin
  perform private.assert_report(p_from, p_to);
  perform private.assert_basis(p_basis);
  return query
    with ch(c, sort) as (values ('cash', 1), ('evc_plus', 2), ('edahab', 3), ('zaad', 4), ('bank_transfer', 5), ('card', 6), ('other', 7)),
    cur as (select x.channel, sum(x.amount) a, count(*) n from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood, p_pos) x group by 1),
    prev as (select x.channel, sum(x.amount) a, count(*) n from private.collection_rows(p_from - v_days, p_from - 1, p_basis, p_district, p_section, p_sector, p_neighbourhood, p_pos) x group by 1)
    select ch.c, coalesce(cur.a, 0), coalesce(prev.a, 0), coalesce(cur.n, 0), coalesce(prev.n, 0), p_from - v_days, p_from - 1
      from ch left join cur on cur.channel = ch.c left join prev on prev.channel = ch.c
     order by ch.sort;
end;
$$;

grant execute on function public.report_collections_compare(date, date, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.report_collections_compare(date, date, text, uuid, uuid, uuid, uuid, uuid) from public, anon;

/** Collections by cashier, with what is still unchecked and the shortages and excess found in their reconciliations. */
create function public.report_collections_cashier(p_from date, p_to date, p_basis text default 'verified',
                                                             p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                             p_neighbourhood uuid default null, p_pos uuid default null)
returns table (cashier_id uuid, cashier text, payments bigint, cash numeric, evc_plus numeric, edahab numeric, zaad numeric,
               bank_transfer numeric, card numeric, other numeric, total numeric, unchecked numeric, days bigint, reconciled_days bigint,
               shortage numeric, excess numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  perform private.assert_basis(p_basis);
  return query
    with r as (select * from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood, p_pos)),
    al as (select * from private.collection_rows(p_from, p_to, 'all', p_district, p_section, p_sector, p_neighbourhood, p_pos)),
    rec as (
      select c.cashier_id, count(*) filter (where c.status = 'approved') n,
             coalesce(sum(l.sh), 0) sh, coalesce(sum(l.ex), 0) ex
        from public.cashier_reconciliations c
        left join lateral (select sum(cl.shortage) sh, sum(cl.excess) ex from public.cashier_reconciliation_lines cl where cl.reconciliation_id = c.id) l on true
       where c.status <> 'rejected' and c.business_date between p_from and p_to
         and (c.district_id is null or public.can_access_district(c.district_id)) and (p_district is null or c.district_id = p_district)
       group by c.cashier_id
    ), who as (select distinct al.created_by from al)
    select w.created_by, coalesce(pr.full_name, 'Online'),
           (select count(*) from r where r.created_by is not distinct from w.created_by),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'cash'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'evc_plus'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'edahab'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'zaad'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'bank_transfer'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'card'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by and r.channel = 'other'),
           (select coalesce(sum(r.amount), 0) from r where r.created_by is not distinct from w.created_by),
           (select coalesce(sum(al.amount), 0) from al where al.created_by is not distinct from w.created_by and al.verify_status in ('pending', 'disputed')),
           (select count(distinct (al.received_at at time zone 'UTC')::date) from al where al.created_by is not distinct from w.created_by),
           coalesce(rec.n, 0), coalesce(rec.sh, 0), coalesce(rec.ex, 0)
      from who w
      left join public.profiles pr on pr.user_id = w.created_by
      left join rec on rec.cashier_id = w.created_by
     order by 2;
end;
$$;

grant execute on function public.report_collections_cashier(date, date, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.report_collections_cashier(date, date, text, uuid, uuid, uuid, uuid, uuid) from public, anon;

/** Payments not yet reconciled (pending, verified or disputed), oldest first. */
create function public.report_unreconciled(p_from date, p_to date, p_district uuid default null,
                                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null, p_pos uuid default null)
returns table (payment_id uuid, parcel_id uuid, receipt_no text, received_at timestamptz, cashier text, channel text, reference text,
               pun text, amount numeric, verify_status text, age_days int, dispute_reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select p.id, pa.id, p.receipt_no, p.received_at, coalesce(pr.full_name, 'Online'), private.collection_channel(p.method, p.wallet),
           coalesce(p.reference, p.provider_ref), pa.pun, p.amount_base, p.verify_status, (current_date - p.received_at::date)::int, p.dispute_reason
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.profiles pr on pr.user_id = p.created_by
     where p.status <> 'reversed' and p.verify_status <> 'reconciled' and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_pos is null or p.pos_id = p_pos)
     order by p.received_at
     limit 10000;
end;
$$;

grant execute on function public.report_unreconciled(date, date, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.report_unreconciled(date, date, uuid, uuid, uuid, uuid, uuid) from public, anon;

/** Verification and approval facts printed on every collections report. */
create function public.report_collections_status(p_from date, p_to date, p_district uuid default null,
                                                            p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null, p_pos uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_report(p_from, p_to);
  select jsonb_build_object(
           'pending', jsonb_build_object('n', count(*) filter (where x.verify_status = 'pending'), 'amount', coalesce(sum(x.amount) filter (where x.verify_status = 'pending'), 0)),
           'verified', jsonb_build_object('n', count(*) filter (where x.verify_status = 'verified'), 'amount', coalesce(sum(x.amount) filter (where x.verify_status = 'verified'), 0)),
           'reconciled', jsonb_build_object('n', count(*) filter (where x.verify_status = 'reconciled'), 'amount', coalesce(sum(x.amount) filter (where x.verify_status = 'reconciled'), 0)),
           'disputed', jsonb_build_object('n', count(*) filter (where x.verify_status = 'disputed'), 'amount', coalesce(sum(x.amount) filter (where x.verify_status = 'disputed'), 0)))
    into v
    from private.collection_rows(p_from, p_to, 'all', p_district, p_section, p_sector, p_neighbourhood, p_pos) x;
  return v || (
    select jsonb_build_object(
             'approved', count(*) filter (where c.status = 'approved'),
             'waiting', count(*) filter (where c.status = 'submitted'),
             'approvers', coalesce(string_agg(distinct dp.full_name, ', ') filter (where c.status = 'approved'), ''),
             'last_approved_at', max(c.decided_at) filter (where c.status = 'approved'))
      from public.cashier_reconciliations c
      left join public.profiles dp on dp.user_id = c.decided_by
     where c.business_date between p_from and p_to and c.status <> 'rejected'
       and (c.district_id is null or public.can_access_district(c.district_id)) and (p_district is null or c.district_id = p_district));
end;
$$;

grant execute on function public.report_collections_status(date, date, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.report_collections_status(date, date, uuid, uuid, uuid, uuid, uuid) from public, anon;

create function public.report_payments(p_from date, p_to date, p_district uuid default null,
                                       p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null,
                                       p_method text default null, p_fee_type text default null, p_pos uuid default null)
returns table (payment_id uuid, parcel_id uuid, receipt_no text, received_at timestamptz, pun text, invoices text,
               fee_types_so text, fee_types_en text, method text, cashier text,
               point_of_sale text, payer text, amount numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  if p_method is not null and p_method not in ('cash', 'evc_plus', 'edahab', 'zaad', 'mobile_money', 'bank_transfer', 'card', 'other') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  return query
    select pm.id, p.id, pm.receipt_no, pm.received_at, p.pun,
           (select string_agg(i.number, ', ' order by i.number) from public.payment_allocations a join public.invoices i on i.id = a.invoice_id where a.payment_id = pm.id),
           (select string_agg(distinct ft.name_so, ', ') from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
              join public.fee_types ft on ft.id = i.fee_type_id where a.payment_id = pm.id),
           (select string_agg(distinct ft.name_en, ', ') from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
              join public.fee_types ft on ft.id = i.fee_type_id where a.payment_id = pm.id),
           pm.method::text, pr.full_name, case when pos.id is null then null else pos.code || ' · ' || pos.name end,
           pm.payer_name, pm.amount, pm.status::text
      from public.payments pm
      left join public.parcels p on p.id = pm.parcel_id
      left join public.profiles pr on pr.user_id = pm.created_by
      left join public.points_of_sale pos on pos.id = pm.pos_id
     where pm.received_at >= p_from and pm.received_at < p_to + 1
       and (pm.district_id is null or public.can_access_district(pm.district_id))
       and (p_district is null or pm.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_pos is null or pm.pos_id = p_pos)
       and (p_method is null or pm.method::text = p_method or private.collection_channel(pm.method, pm.wallet) = p_method)
       and (p_fee_type is null
            or exists (select 1 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
                         join public.fee_types ft on ft.id = i.fee_type_id
                        where a.payment_id = pm.id and ft.code = p_fee_type)
            or (p_fee_type = 'credit' and pm.unallocated > 0))
     order by pm.received_at desc
     limit 10000;
end;
$$;

grant execute on function public.report_payments(date, date, uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;
revoke execute on function public.report_payments(date, date, uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;

revoke all on function private.collection_rows(date, date, text, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
