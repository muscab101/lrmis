-- Parcels list: owners, last bill and balance are fetched for all the listed land at once (one lookup each),
-- instead of one lookup per row. Inside a per-row lookup the access rules of owners and bills were worked out again
-- for every row (about 40 checks a row), so 100 rows took 3-5 seconds. The rules themselves are unchanged.

create or replace function public.search_parcels(p_q text, p_limit integer default 20, p_stage text default null,
                                                 p_neighbourhood uuid default null)
returns table(id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text,
              created_at timestamptz, house_no text, govt_receipt_no text, invoice text, balance numeric, locked_at timestamptz,
              lock_reason text, application_number text, district_en text, neighbourhood_en text, plot_no text, building_state text,
              parent_id uuid)
language sql
stable
set search_path = ''
as $$
  with owing as (
    -- Land with an unpaid bill (itself or one of its flats), worked out once for the Paid and Not paid tabs.
    -- (a flat with an unpaid bill is owing, and so is its building)
    select x.land_id
      from public.invoices i join public.parcels c on c.id = i.parcel_id
      cross join lateral (values (c.id), (c.parent_id)) x(land_id)
     where p_stage in ('paid', 'owing') and i.status in ('issued', 'partially_paid') and i.balance > 0 and c.deleted_at is null
       and x.land_id is not null
     group by 1
  ), picked as (
    select p.* from public.parcels p
      left join public.applications a on a.id = p.application_id
     where p.deleted_at is null and p.status <> 'archived' and p.layout = 'house'
       and (p_neighbourhood is null or p.neighbourhood_id = p_neighbourhood)
       -- Partial registration: not registered yet; every other tab: registered land (Demolished: demolished only).
       and (p_stage is null
            or (p_stage = 'draft' and p.status in ('draft', 'surveyed', 'verified'))
            or (p_stage in ('registered', 'paid', 'owing', 'demolished') and p.status not in ('draft', 'surveyed', 'verified')))
       and (p_stage is distinct from 'demolished' or p.building_state = 'demolished')
       and (p_stage is distinct from 'owing' or p.id in (select land_id from owing))
       and (p_stage is distinct from 'paid' or p.id not in (select land_id from owing))
       and (coalesce(trim(p_q), '') = ''
            or (p.pun ilike '%' || trim(p_q) || '%' or coalesce(p.pun_old, '') ilike '%' || trim(p_q) || '%')
            or p.account_no ilike trim(p_q) || '%'
            or p.house_no ilike trim(p_q) || '%'
            or p.govt_receipt_no ilike trim(p_q) || '%'
            or a.number ilike trim(p_q) || '%'
            or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
            or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                        where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%')
            or exists (select 1 from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                        where ap.application_id = p.application_id and pa.full_name ilike '%' || trim(p_q) || '%'))
     order by p.created_at desc
     limit least(greatest(p_limit, 1), 5000)
  ), family as (
    -- Each listed land and its flats.
    select p.id as land_id, p.id as pid, true as live from picked p
    union all
    select p.id, c.id, c.status <> 'archived' from picked p join public.parcels c on c.parent_id = p.id and c.deleted_at is null
  ), owner_names as (
    select f.land_id, string_agg(distinct pa.full_name, ', ') as names
      from family f join public.parcel_owners po on po.parcel_id = f.pid and po.valid_to is null
      join public.parties pa on pa.id = po.party_id
     where f.live
     group by 1
  ), applicant_names as (
    select p.id as land_id, string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) as names
      from picked p join public.application_parties ap on ap.application_id = p.application_id and ap.role in ('owner', 'co_owner')
      join public.parties pa on pa.id = ap.party_id
     group by 1
  ), balances as (
    select f.land_id, sum(i.balance) as balance
      from family f join public.invoices i on i.parcel_id = f.pid and i.status in ('issued', 'partially_paid')
     group by 1
  ), last_bill as (
    select distinct on (i.parcel_id) i.parcel_id, i.number
      from picked p join public.invoices i on i.parcel_id = p.id and i.status <> 'cancelled'
     order by i.parcel_id, (i.status in ('issued', 'partially_paid')) desc, i.created_at desc
  )
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         coalesce(o.names, an.names), p.created_at, p.house_no, p.govt_receipt_no,
         lb.number, coalesce(b.balance, 0),
         p.locked_at, p.lock_reason, a.number, d.name_en, n.name_en, p.plot_no, p.building_state, p.parent_id
    from picked p
    join public.districts d on d.id = p.district_id
    left join public.neighbourhoods n on n.id = p.neighbourhood_id
    left join public.applications a on a.id = p.application_id
    left join owner_names o on o.land_id = p.id
    left join applicant_names an on an.land_id = p.id
    left join balances b on b.land_id = p.id
    left join last_bill lb on lb.parcel_id = p.id
   order by p.created_at desc;
$$;
