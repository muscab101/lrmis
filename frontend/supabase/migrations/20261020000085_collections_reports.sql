-- Collections, stage 4: finance reports. Every one splits money into Cash, EVC Plus, eDahab, ZAAD, Bank transfer,
-- Card (Visa / Mastercard) and Other, with a grand total, and takes the place filters (district, section, sector,
-- neighbourhood). p_basis: 'verified' (default) counts only payments a finance officer verified or reconciled;
-- 'all' counts everything recorded. Weeks run Monday to Sunday; months are calendar months.

/** Payments in a period for the collections reports, with their column (channel). */
create or replace function private.collection_rows(p_from date, p_to date, p_basis text, p_district uuid,
                                                   p_section uuid, p_sector uuid, p_neighbourhood uuid)
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
     and (coalesce(p_basis, 'verified') = 'all' or p.verify_status in ('verified', 'reconciled'));
$$;

create or replace function private.assert_basis(p_basis text, p_by text default 'day')
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_basis, 'verified') not in ('verified', 'all') then
    perform private.raise_app_error('VALIDATION', 'basis');
  end if;
  if coalesce(p_by, 'day') not in ('day', 'week', 'month') then
    perform private.raise_app_error('VALIDATION', 'by');
  end if;
end;
$$;

/** Daily, weekly or monthly collections. */
create or replace function public.report_collections(p_from date, p_to date, p_by text default 'day', p_basis text default 'verified',
                                                     p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                     p_neighbourhood uuid default null)
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
    with r as (select date_trunc(coalesce(p_by, 'day'), x.received_at)::date pd, x.* from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood) x)
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

/** Totals per column for the period and the period of the same length just before it. */
create or replace function public.report_collections_compare(p_from date, p_to date, p_basis text default 'verified',
                                                             p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                             p_neighbourhood uuid default null)
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
    cur as (select x.channel, sum(x.amount) a, count(*) n from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood) x group by 1),
    prev as (select x.channel, sum(x.amount) a, count(*) n from private.collection_rows(p_from - v_days, p_from - 1, p_basis, p_district, p_section, p_sector, p_neighbourhood) x group by 1)
    select ch.c, coalesce(cur.a, 0), coalesce(prev.a, 0), coalesce(cur.n, 0), coalesce(prev.n, 0), p_from - v_days, p_from - 1
      from ch left join cur on cur.channel = ch.c left join prev on prev.channel = ch.c
     order by ch.sort;
end;
$$;

/** Collections by cashier, with what is still unchecked and the shortages and excess found in their reconciliations. */
create or replace function public.report_collections_cashier(p_from date, p_to date, p_basis text default 'verified',
                                                             p_district uuid default null, p_section uuid default null, p_sector uuid default null,
                                                             p_neighbourhood uuid default null)
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
    with r as (select * from private.collection_rows(p_from, p_to, p_basis, p_district, p_section, p_sector, p_neighbourhood)),
    al as (select * from private.collection_rows(p_from, p_to, 'all', p_district, p_section, p_sector, p_neighbourhood)),
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

-- Payments by type (revenue category) now uses the collections columns.
drop function if exists public.report_payment_types(date, date, uuid, uuid, uuid, uuid);
create function public.report_payment_types(p_from date, p_to date, p_district uuid default null,
                                            p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null,
                                            p_basis text default 'verified')
returns table (fee_type text, fee_name_so text, fee_name_en text, payments bigint,
               cash numeric, evc_plus numeric, edahab numeric, zaad numeric, bank_transfer numeric, card numeric, other numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  perform private.assert_basis(p_basis);
  return query
    with paid as (
      select ft.code, ft.name_so, ft.name_en, ft.sort, p.id payment_id, private.collection_channel(p.method, p.wallet) channel, a.amount
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id and p.status = 'completed'
        join public.invoices i on i.id = a.invoice_id
        join public.fee_types ft on ft.id = i.fee_type_id
        left join public.parcels pa on pa.id = i.parcel_id
       where p.received_at >= p_from and p.received_at < p_to + 1
         and (coalesce(p_basis, 'verified') = 'all' or p.verify_status in ('verified', 'reconciled'))
         and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
         and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
      union all
      select 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', 10000, p.id, private.collection_channel(p.method, p.wallet), p.unallocated
        from public.payments p
        left join public.parcels pa on pa.id = p.parcel_id
       where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
         and (coalesce(p_basis, 'verified') = 'all' or p.verify_status in ('verified', 'reconciled'))
         and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
         and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
    )
    select x.code, x.name_so, x.name_en, count(distinct x.payment_id),
           coalesce(sum(x.amount) filter (where x.channel = 'cash'), 0), coalesce(sum(x.amount) filter (where x.channel = 'evc_plus'), 0),
           coalesce(sum(x.amount) filter (where x.channel = 'edahab'), 0), coalesce(sum(x.amount) filter (where x.channel = 'zaad'), 0),
           coalesce(sum(x.amount) filter (where x.channel = 'bank_transfer'), 0), coalesce(sum(x.amount) filter (where x.channel = 'card'), 0),
           coalesce(sum(x.amount) filter (where x.channel = 'other'), 0), sum(x.amount)
      from paid x
     group by x.code, x.name_so, x.name_en, x.sort
     order by x.sort, x.code;
end;
$$;

/** Cashier reconciliations in a period: recorded, actual, difference per column, shortage, excess, who prepared and approved. */
create or replace function public.report_cashier_shortages(p_from date, p_to date, p_district uuid default null)
returns table (reconciliation_id uuid, number text, business_date date, cashier_id uuid, cashier text, recorded numeric, actual numeric,
               cash numeric, evc_plus numeric, edahab numeric, zaad numeric, bank_transfer numeric, card numeric, other numeric,
               difference numeric, shortage numeric, excess numeric, status text, prepared_by text, approved_by text, decided_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select c.id, c.number, c.business_date, c.cashier_id, pr.full_name, c.recorded, c.actual,
           coalesce(sum(l.difference) filter (where l.channel = 'cash'), 0), coalesce(sum(l.difference) filter (where l.channel = 'evc_plus'), 0),
           coalesce(sum(l.difference) filter (where l.channel = 'edahab'), 0), coalesce(sum(l.difference) filter (where l.channel = 'zaad'), 0),
           coalesce(sum(l.difference) filter (where l.channel = 'bank_transfer'), 0), coalesce(sum(l.difference) filter (where l.channel = 'card'), 0),
           coalesce(sum(l.difference) filter (where l.channel = 'other'), 0),
           c.difference, coalesce(sum(l.shortage), 0), coalesce(sum(l.excess), 0), c.status, pp.full_name,
           case when c.status = 'approved' then dp.full_name end, c.decided_at
      from public.cashier_reconciliations c
      left join public.cashier_reconciliation_lines l on l.reconciliation_id = c.id
      left join public.profiles pr on pr.user_id = c.cashier_id
      left join public.profiles pp on pp.user_id = c.prepared_by
      left join public.profiles dp on dp.user_id = c.decided_by
     where c.status <> 'rejected' and c.business_date between p_from and p_to
       and (c.district_id is null or public.can_access_district(c.district_id)) and (p_district is null or c.district_id = p_district)
     group by c.id, pr.full_name, pp.full_name, dp.full_name
     order by c.business_date desc, pr.full_name;
end;
$$;

/** Payments not yet reconciled (pending, verified or disputed), oldest first. */
create or replace function public.report_unreconciled(p_from date, p_to date, p_district uuid default null,
                                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
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
     order by p.received_at
     limit 10000;
end;
$$;

/** Verification and approval facts printed on every collections report. */
create or replace function public.report_collections_status(p_from date, p_to date, p_district uuid default null,
                                                            p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
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
    from private.collection_rows(p_from, p_to, 'all', p_district, p_section, p_sector, p_neighbourhood) x;
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

revoke all on function private.collection_rows(date, date, text, uuid, uuid, uuid, uuid), private.assert_basis(text, text) from public, anon, authenticated;
revoke all on function public.report_collections(date, date, text, text, uuid, uuid, uuid, uuid),
  public.report_collections_compare(date, date, text, uuid, uuid, uuid, uuid),
  public.report_collections_cashier(date, date, text, uuid, uuid, uuid, uuid),
  public.report_payment_types(date, date, uuid, uuid, uuid, uuid, text),
  public.report_cashier_shortages(date, date, uuid),
  public.report_unreconciled(date, date, uuid, uuid, uuid, uuid),
  public.report_collections_status(date, date, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.report_collections(date, date, text, text, uuid, uuid, uuid, uuid),
  public.report_collections_compare(date, date, text, uuid, uuid, uuid, uuid),
  public.report_collections_cashier(date, date, text, uuid, uuid, uuid, uuid),
  public.report_payment_types(date, date, uuid, uuid, uuid, uuid, text),
  public.report_cashier_shortages(date, date, uuid),
  public.report_unreconciled(date, date, uuid, uuid, uuid, uuid),
  public.report_collections_status(date, date, uuid, uuid, uuid, uuid) to authenticated;
