-- Reports by place: every report with a location takes section, sector and neighbourhood besides the
-- district (all optional), so figures can be narrowed District → Section → Sector → Neighbourhood.
-- The listing reports also return the ids of what each row is about (invoice, payment, parcel, owner,
-- document) so the Reports page can link rows to their records. Income and Cashiers have no place.

/** A parcel's neighbourhood lies in the chosen section / sector / neighbourhood (true when none is chosen). */
create or replace function private.in_area(p_nbhd uuid, p_section uuid, p_sector uuid, p_neighbourhood uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_section is null and p_sector is null and p_neighbourhood is null)
      or exists (select 1 from public.neighbourhoods n join public.sectors k on k.id = n.sector_id
                  where n.id = p_nbhd
                    and (p_neighbourhood is null or n.id = p_neighbourhood)
                    and (p_sector is null or k.id = p_sector)
                    and (p_section is null or k.section_id = p_section));
$$;
revoke all on function private.in_area(uuid, uuid, uuid, uuid) from public, anon, authenticated;

drop function if exists public.report_revenue(date, date, uuid);
drop function if exists public.report_arrears(uuid);
drop function if exists public.report_collection(date, date);
drop function if exists public.report_registrations(date, date, uuid);
drop function if exists public.report_billing(date, date, uuid);
drop function if exists public.report_invoices(date, date, uuid);
drop function if exists public.report_payments(date, date, uuid);
drop function if exists public.report_certificates(date, date, uuid);
drop function if exists public.report_parcels(uuid, text);
drop function if exists public.report_locations(uuid);
drop function if exists public.report_owners(uuid);

/** Money received per month and fee type (allocated amounts; unallocated credit shown as its own line). */
create function public.report_revenue(p_from date, p_to date, p_district uuid default null,
                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (month text, fee_type text, fee_name_so text, fee_name_en text, amount numeric, payments bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), ft.code, ft.name_so, ft.name_en, sum(a.amount)::numeric, count(distinct p.id)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.status = 'completed'
      join public.invoices i on i.id = a.invoice_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels pa on pa.id = i.parcel_id
     where p.received_at >= p_from and p.received_at < p_to + 1
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     group by 1, 2, 3, 4
    union all
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', sum(p.unallocated)::numeric, count(*)
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
     where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     group by 1
     order by 1, 2;
end;
$$;

/** Open balances by district and age past the due date. */
create function public.report_arrears(p_district uuid default null, p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (district_id uuid, district_so text, district_en text, invoices bigint, not_due numeric, d1_30 numeric, d31_90 numeric, d91_180 numeric, d180 numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select d.id, d.name_so, d.name_en, count(*),
           coalesce(sum(i.balance) filter (where i.due_date >= current_date), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 1 and 30), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 31 and 90), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 91 and 180), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date > 180), 0),
           sum(i.balance)
      from public.invoices i join public.districts d on d.id = i.district_id
      left join public.parcels pa on pa.id = i.parcel_id
     where i.status in ('issued', 'partially_paid') and i.balance > 0
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     group by d.id, d.name_so, d.name_en
     order by sum(i.balance) desc;
end;
$$;

/** Bills issued in the period and how much of them has been paid or credited, by district. */
create function public.report_collection(p_from date, p_to date, p_district uuid default null,
                                         p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (district_id uuid, district_so text, district_en text, invoices bigint, billed numeric, collected numeric, credited numeric, outstanding numeric, rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select d.id, d.name_so, d.name_en, count(*), sum(i.total), sum(i.paid), sum(i.credited), sum(i.balance),
           case when sum(i.total) > 0 then round(100 * sum(i.paid + i.credited) / sum(i.total), 1) else 0 end
      from public.invoices i join public.districts d on d.id = i.district_id
      left join public.parcels pa on pa.id = i.parcel_id
     where i.status <> 'cancelled' and i.issue_date between p_from and p_to and public.can_access_district(i.district_id)
       and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     group by d.id, d.name_so, d.name_en
     order by d.name_en;
end;
$$;

/** Applications in and parcels registered per month, with the median days from submission to registration. */
create function public.report_registrations(p_from date, p_to date, p_district uuid default null,
                                            p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (month text, submitted bigint, registered bigint, rejected bigint, median_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    with months as (
      select to_char(m, 'YYYY-MM') m from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
    ), sub as (
      select to_char(a.submitted_at, 'YYYY-MM') m, count(*) n from public.applications a
       where a.submitted_at >= p_from and a.submitted_at < p_to + 1 and public.can_access_district(a.district_id)
         and (p_district is null or a.district_id = p_district)
         and private.in_area(a.neighbourhood_id, p_section, p_sector, p_neighbourhood) group by 1
    ), rej as (
      select to_char(a.decided_at, 'YYYY-MM') m, count(*) n from public.applications a
       where a.status = 'rejected' and a.decided_at >= p_from and a.decided_at < p_to + 1 and public.can_access_district(a.district_id)
         and (p_district is null or a.district_id = p_district)
         and private.in_area(a.neighbourhood_id, p_section, p_sector, p_neighbourhood) group by 1
    ), reg as (
      select to_char(p.registered_at, 'YYYY-MM') m, count(*) n,
             percentile_cont(0.5) within group (order by extract(epoch from p.registered_at - a.submitted_at) / 86400) md
        from public.parcels p left join public.applications a on a.id = p.application_id
       where p.registered_at >= p_from and p.registered_at < p_to + 1 and public.can_access_district(p.district_id)
         and (p_district is null or p.district_id = p_district)
         and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood) group by 1
    )
    select months.m, coalesce(sub.n, 0), coalesce(reg.n, 0), coalesce(rej.n, 0), round(reg.md::numeric, 1)
      from months left join sub using (m) left join reg using (m) left join rej using (m)
     order by 1;
end;
$$;

/** Bills issued in the range by month, district and fee type, with what has been collected and what is still owed. */
create function public.report_billing(p_from date, p_to date, p_district uuid default null,
                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (month text, district_id uuid, district_so text, district_en text, fee_type text, fee_name_so text, fee_name_en text,
               invoices bigint, billed numeric, collected numeric, credited numeric, outstanding numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select to_char(i.issue_date, 'YYYY-MM'), d.id, d.name_so, d.name_en, ft.code, ft.name_so, ft.name_en,
           count(*), sum(i.total), sum(i.paid), sum(i.credited), sum(i.balance)
      from public.invoices i
      join public.districts d on d.id = i.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels pa on pa.id = i.parcel_id
     where i.status <> 'cancelled' and i.issue_date between p_from and p_to
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     group by 1, d.id, d.name_so, d.name_en, ft.code, ft.name_so, ft.name_en, ft.sort
     order by 1, d.name_en, ft.sort;
end;
$$;

/** Every invoice issued in the range. */
create function public.report_invoices(p_from date, p_to date, p_district uuid default null,
                                       p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (invoice_id uuid, parcel_id uuid, number text, pun text, district_so text, district_en text, fee_name_so text, fee_name_en text,
               period text, issue_date date, due_date date, total numeric, paid numeric, balance numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select i.id, p.id, i.number, p.pun, d.name_so, d.name_en, ft.name_so, ft.name_en, i.period, i.issue_date, i.due_date,
           i.total, i.paid + i.credited, i.balance, i.status::text
      from public.invoices i
      join public.districts d on d.id = i.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels p on p.id = i.parcel_id
     where i.issue_date between p_from and p_to
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by i.issue_date desc, i.number desc
     limit 10000;
end;
$$;

/** Every payment received in the range, with the invoices it paid, the cashier and the point of sale. */
create function public.report_payments(p_from date, p_to date, p_district uuid default null,
                                       p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (payment_id uuid, parcel_id uuid, receipt_no text, received_at timestamptz, pun text, invoices text, method text, cashier text,
               point_of_sale text, payer text, amount numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select pm.id, p.id, pm.receipt_no, pm.received_at, p.pun,
           (select string_agg(i.number, ', ' order by i.number) from public.payment_allocations a join public.invoices i on i.id = a.invoice_id where a.payment_id = pm.id),
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
     order by pm.received_at desc
     limit 10000;
end;
$$;

/** Certificates and other documents issued in the range. */
create function public.report_certificates(p_from date, p_to date, p_district uuid default null,
                                           p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (document_id uuid, parcel_id uuid, serial text, type text, pun text, owner text, district_so text, district_en text,
               issued_at timestamptz, issued_by text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select doc.id, p.id, doc.serial, doc.type::text, p.pun,
           coalesce(pa.full_name, (select string_agg(op.full_name, ', ' order by o.share_pct desc nulls last, op.full_name)
                                     from public.parcel_owners o join public.parties op on op.id = o.party_id
                                    where o.parcel_id = doc.parcel_id and o.valid_to is null and o.role in ('owner', 'co_owner', 'heir'))),
           d.name_so, d.name_en, doc.issued_at, pr.full_name, doc.status::text
      from public.issued_documents doc
      left join public.parcels p on p.id = doc.parcel_id
      left join public.parties pa on pa.id = doc.party_id
      left join public.districts d on d.id = doc.district_id
      left join public.profiles pr on pr.user_id = doc.issued_by
     where doc.issued_at >= p_from and doc.issued_at < p_to + 1
       and (doc.district_id is null or public.can_access_district(doc.district_id))
       and (p_district is null or doc.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by doc.issued_at desc
     limit 10000;
end;
$$;

/** Parcels: 'registered', 'partial' (draft or provisional land not yet registered) or 'all'. */
create function public.report_parcels(p_district uuid default null, p_kind text default 'all',
                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (parcel_id uuid, pun text, district_so text, district_en text, neighbourhood_so text, neighbourhood_en text, house_no text,
               area_m2 numeric, land_use text, grade_so text, grade_en text, status text, provisional boolean,
               owners text, registered_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  if coalesce(p_kind, 'all') not in ('all', 'registered', 'partial') then
    perform private.raise_app_error('VALIDATION', 'kind');
  end if;
  return query
    select p.id, p.pun, d.name_so, d.name_en, n.name_so, n.name_en, p.house_no, p.area_m2, p.land_use::text,
           g.name_so, g.name_en, p.status::text, p.geom_provisional,
           (select string_agg(pa.full_name, ', ' order by o.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners o join public.parties pa on pa.id = o.party_id
             where o.parcel_id = p.id and o.valid_to is null and o.role in ('owner', 'co_owner', 'heir')),
           p.registered_at, p.created_at
      from public.parcels p
      join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join public.property_grades g on g.code = p.property_type
     where p.deleted_at is null and p.status <> 'archived'
       and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and case coalesce(p_kind, 'all')
             when 'registered' then p.status = 'registered'
             when 'partial' then p.status in ('draft', 'surveyed', 'verified')
             else true end
     order by d.name_en, p.pun nulls last, p.created_at
     limit 10000;
end;
$$;

/** Districts, sections, sectors and neighbourhoods with their parcel counts and whether a boundary is drawn. */
create function public.report_locations(p_district uuid default null, p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (level text, code text, name_so text, name_en text, district_so text, district_en text,
               parcels bigint, registered bigint, partial bigint, has_boundary boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    with pc as (
      select p.district_id, p.neighbourhood_id, p.status
        from public.parcels p
       where p.deleted_at is null and p.status <> 'archived'
    ), loc as (
      select 0 lvl, 'district' level, d.id, d.code, d.name_so, d.name_en, d.id district_id, d.has_geom,
             d.code sort_key, null::uuid section_id, null::uuid sector_id, null::uuid nbhd_id
        from public.districts d where d.deleted_at is null
      union all
      select 1, 'section', s.id, s.code, s.name_so, s.name_en, s.district_id, s.has_geom, d.code || '/' || s.code, s.id, null, null
        from public.sections s join public.districts d on d.id = s.district_id where s.deleted_at is null
      union all
      select 2, 'sector', k.id, k.code, k.name_so, k.name_en, k.district_id, k.has_geom, d.code || '/' || s.code || '/' || k.code, s.id, k.id, null
        from public.sectors k join public.sections s on s.id = k.section_id join public.districts d on d.id = k.district_id
       where k.deleted_at is null
      union all
      select 3, 'neighbourhood', n.id, n.code, n.name_so, n.name_en, n.district_id, n.has_geom,
             d.code || '/' || s.code || '/' || k.code || '/' || n.code, s.id, k.id, n.id
        from public.neighbourhoods n join public.sectors k on k.id = n.sector_id join public.sections s on s.id = k.section_id
        join public.districts d on d.id = n.district_id
       where n.deleted_at is null
    )
    select l.level, l.code, l.name_so, l.name_en, d.name_so, d.name_en, c.total, c.registered, c.partial, coalesce(l.has_geom, false)
      from loc l
      join public.districts d on d.id = l.district_id
      cross join lateral (
        select count(*) total,
               count(*) filter (where pc.status = 'registered') registered,
               count(*) filter (where pc.status in ('draft', 'surveyed', 'verified')) partial
          from pc
          left join public.neighbourhoods n on n.id = pc.neighbourhood_id
          left join public.sectors k on k.id = n.sector_id
         where case l.lvl
                 when 0 then pc.district_id = l.id
                 when 1 then k.section_id = l.id
                 when 2 then n.sector_id = l.id
                 else pc.neighbourhood_id = l.id end
      ) c
     where public.can_access_district(l.district_id) and (p_district is null or l.district_id = p_district)
       -- A chosen place shows itself and what lies inside it (not the levels above it).
       and (p_section is null or l.section_id = p_section)
       and (p_sector is null or l.sector_id = p_sector)
       and (p_neighbourhood is null or l.nbhd_id = p_neighbourhood)
     order by l.sort_key
     limit 10000;
end;
$$;

/** Owners and the parcels they hold now, one row per owner and parcel. */
create function public.report_owners(p_district uuid default null, p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (party_id uuid, parcel_id uuid, owner text, phone text, id_type text, id_number text, role text, share_pct numeric, pun text,
               district_so text, district_en text, neighbourhood_so text, neighbourhood_en text, area_m2 numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select pa.id, p.id, pa.full_name, pa.phone, pa.id_type::text, pa.id_number, o.role::text, o.share_pct, p.pun,
           d.name_so, d.name_en, n.name_so, n.name_en, p.area_m2, p.status::text
      from public.parcel_owners o
      join public.parties pa on pa.id = o.party_id and pa.deleted_at is null
      join public.parcels p on p.id = o.parcel_id and p.deleted_at is null
      join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
     where o.valid_to is null and o.role <> 'agent'
       and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by pa.full_name, p.pun nulls last
     limit 10000;
end;
$$;

grant execute on function
  public.report_revenue(date, date, uuid, uuid, uuid, uuid), public.report_arrears(uuid, uuid, uuid, uuid),
  public.report_collection(date, date, uuid, uuid, uuid, uuid), public.report_registrations(date, date, uuid, uuid, uuid, uuid),
  public.report_billing(date, date, uuid, uuid, uuid, uuid), public.report_invoices(date, date, uuid, uuid, uuid, uuid),
  public.report_payments(date, date, uuid, uuid, uuid, uuid), public.report_certificates(date, date, uuid, uuid, uuid, uuid),
  public.report_parcels(uuid, text, uuid, uuid, uuid), public.report_locations(uuid, uuid, uuid, uuid), public.report_owners(uuid, uuid, uuid, uuid)
to authenticated;
revoke execute on function
  public.report_revenue(date, date, uuid, uuid, uuid, uuid), public.report_arrears(uuid, uuid, uuid, uuid),
  public.report_collection(date, date, uuid, uuid, uuid, uuid), public.report_registrations(date, date, uuid, uuid, uuid, uuid),
  public.report_billing(date, date, uuid, uuid, uuid, uuid), public.report_invoices(date, date, uuid, uuid, uuid, uuid),
  public.report_payments(date, date, uuid, uuid, uuid, uuid), public.report_certificates(date, date, uuid, uuid, uuid, uuid),
  public.report_parcels(uuid, text, uuid, uuid, uuid), public.report_locations(uuid, uuid, uuid, uuid), public.report_owners(uuid, uuid, uuid, uuid)
from public, anon;
