-- Parcels list, fast again: the 100 rows are chosen first (with a quick "has an unpaid bill" check for the Paid and
-- Not paid tabs), and owners, last bill and balance are worked out for those 100 only. 0258 worked them out for every
-- plot before choosing, which took over 8 seconds with ~4,600 plots, so the Registered tab was cancelled.
-- "This land or one of its flats" is looked up as a list of ids (the land and its flats), so the indexes on
-- parcel_owners.parcel_id and invoices.parcel_id are used instead of reading every plot each time.

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
  with picked as (
    select p.*, k.ids from public.parcels p
      left join public.applications a on a.id = p.application_id
      cross join lateral (
        select array[p.id] || coalesce(array(select c.id from public.parcels c where c.parent_id = p.id and c.deleted_at is null), '{}') as ids
      ) k
     where p.deleted_at is null and p.status <> 'archived' and p.layout = 'house'
       and (p_neighbourhood is null or p.neighbourhood_id = p_neighbourhood)
       -- Partial registration: not registered yet; every other tab: registered land (Demolished: demolished only).
       and (p_stage is null
            or (p_stage = 'draft' and p.status in ('draft', 'surveyed', 'verified'))
            or (p_stage in ('registered', 'paid', 'owing', 'demolished') and p.status not in ('draft', 'surveyed', 'verified')))
       and (p_stage is distinct from 'demolished' or p.building_state = 'demolished')
       -- Not paid: an unpaid bill on the land (or one of its flats); Paid: none.
       and (p_stage is distinct from 'owing' or exists (
             select 1 from public.invoices i
              where i.parcel_id = any (k.ids) and i.status in ('issued', 'partially_paid') and i.balance > 0))
       and (p_stage is distinct from 'paid' or not exists (
             select 1 from public.invoices i
              where i.parcel_id = any (k.ids) and i.status in ('issued', 'partially_paid') and i.balance > 0))
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
  )
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         coalesce(
           (select string_agg(distinct pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = any (p.ids) and po.valid_to is null
               and (po.parcel_id = p.id or not exists (select 1 from public.parcels c where c.id = po.parcel_id and c.status = 'archived'))),
           (select string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) from public.application_parties ap
              join public.parties pa on pa.id = ap.party_id
             where ap.application_id = p.application_id and ap.role in ('owner', 'co_owner'))),
         p.created_at, p.house_no, p.govt_receipt_no,
         (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
          order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1),
         (select coalesce(sum(i.balance), 0) from public.invoices i
           where i.parcel_id = any (p.ids) and i.status in ('issued', 'partially_paid')),
         p.locked_at, p.lock_reason, a.number, d.name_en, n.name_en, p.plot_no, p.building_state, p.parent_id
    from picked p
    join public.districts d on d.id = p.district_id
    left join public.neighbourhoods n on n.id = p.neighbourhood_id
    left join public.applications a on a.id = p.application_id
   order by p.created_at desc;
$$;
