-- Reports: billing summary (billed vs collected vs outstanding), and listings of invoices, payments,
-- certificates, parcels (registered and partial), locations and owners with their parcels.
-- Every function checks `reports.view` and only returns rows from districts the caller can see.

/** Bills issued in the range by month, district and fee type, with what has been collected and what is still owed. */
create or replace function public.report_billing(p_from date, p_to date, p_district uuid default null)
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
     where i.status <> 'cancelled' and i.issue_date between p_from and p_to
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
     group by 1, d.id, d.name_so, d.name_en, ft.code, ft.name_so, ft.name_en, ft.sort
     order by 1, d.name_en, ft.sort;
end;
$$;

/** Every invoice issued in the range. */
create or replace function public.report_invoices(p_from date, p_to date, p_district uuid default null)
returns table (number text, pun text, district_so text, district_en text, fee_name_so text, fee_name_en text, period text,
               issue_date date, due_date date, total numeric, paid numeric, balance numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select i.number, p.pun, d.name_so, d.name_en, ft.name_so, ft.name_en, i.period, i.issue_date, i.due_date,
           i.total, i.paid + i.credited, i.balance, i.status::text
      from public.invoices i
      join public.districts d on d.id = i.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels p on p.id = i.parcel_id
     where i.issue_date between p_from and p_to
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
     order by i.issue_date desc, i.number desc
     limit 10000;
end;
$$;

/** Every payment received in the range, with the invoices it paid, the cashier and the point of sale. */
create or replace function public.report_payments(p_from date, p_to date, p_district uuid default null)
returns table (receipt_no text, received_at timestamptz, pun text, invoices text, method text, cashier text, point_of_sale text,
               payer text, amount numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select pm.receipt_no, pm.received_at, p.pun,
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
     order by pm.received_at desc
     limit 10000;
end;
$$;

/** Certificates and other documents issued in the range. */
create or replace function public.report_certificates(p_from date, p_to date, p_district uuid default null)
returns table (serial text, type text, pun text, owner text, district_so text, district_en text, issued_at timestamptz, issued_by text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select doc.serial, doc.type::text, p.pun,
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
     order by doc.issued_at desc
     limit 10000;
end;
$$;

/** Parcels: 'registered', 'partial' (draft or provisional land not yet registered) or 'all'. */
create or replace function public.report_parcels(p_district uuid default null, p_kind text default 'all')
returns table (pun text, district_so text, district_en text, neighbourhood_so text, neighbourhood_en text, house_no text,
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
    select p.pun, d.name_so, d.name_en, n.name_so, n.name_en, p.house_no, p.area_m2, p.land_use::text,
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
       and case coalesce(p_kind, 'all')
             when 'registered' then p.status = 'registered'
             when 'partial' then p.status in ('draft', 'surveyed', 'verified')
             else true end
     order by d.name_en, p.pun nulls last, p.created_at
     limit 10000;
end;
$$;

/** Districts, sections, sectors and neighbourhoods with their parcel counts and whether a boundary is drawn. */
create or replace function public.report_locations(p_district uuid default null)
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
             d.code sort_key
        from public.districts d where d.deleted_at is null
      union all
      select 1, 'section', s.id, s.code, s.name_so, s.name_en, s.district_id, s.has_geom, d.code || '/' || s.code
        from public.sections s join public.districts d on d.id = s.district_id where s.deleted_at is null
      union all
      select 2, 'sector', k.id, k.code, k.name_so, k.name_en, k.district_id, k.has_geom, d.code || '/' || s.code || '/' || k.code
        from public.sectors k join public.sections s on s.id = k.section_id join public.districts d on d.id = k.district_id
       where k.deleted_at is null
      union all
      select 3, 'neighbourhood', n.id, n.code, n.name_so, n.name_en, n.district_id, n.has_geom,
             d.code || '/' || s.code || '/' || k.code || '/' || n.code
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
     order by l.sort_key
     limit 10000;
end;
$$;

/** Owners and the parcels they hold now, one row per owner and parcel. */
create or replace function public.report_owners(p_district uuid default null)
returns table (owner text, phone text, id_type text, id_number text, role text, share_pct numeric, pun text,
               district_so text, district_en text, neighbourhood_so text, neighbourhood_en text, area_m2 numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select pa.full_name, pa.phone, pa.id_type::text, pa.id_number, o.role::text, o.share_pct, p.pun,
           d.name_so, d.name_en, n.name_so, n.name_en, p.area_m2, p.status::text
      from public.parcel_owners o
      join public.parties pa on pa.id = o.party_id and pa.deleted_at is null
      join public.parcels p on p.id = o.parcel_id and p.deleted_at is null
      join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
     where o.valid_to is null and o.role <> 'agent'
       and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)
     order by pa.full_name, p.pun nulls last
     limit 10000;
end;
$$;

grant execute on function
  public.report_billing(date, date, uuid), public.report_invoices(date, date, uuid), public.report_payments(date, date, uuid),
  public.report_certificates(date, date, uuid), public.report_parcels(uuid, text), public.report_locations(uuid), public.report_owners(uuid)
to authenticated;
revoke execute on function
  public.report_billing(date, date, uuid), public.report_invoices(date, date, uuid), public.report_payments(date, date, uuid),
  public.report_certificates(date, date, uuid), public.report_parcels(uuid, text), public.report_locations(uuid), public.report_owners(uuid)
from public, anon;
