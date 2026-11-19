-- Parcels list: the tab (Partial registration, Registered, Paid, Not paid, Demolished) and the neighbourhood are now
-- chosen inside search_parcels, before it keeps its 100 newest rows. They were applied to the 100 rows afterwards, so
-- once the old LRMIS plots filled the newest 100 with registered land, Partial registration showed nothing.
-- Other callers (p_q, p_limit only) work as before. Up to 5,000 rows may be asked for (counts); the list asks for 100.
-- The "Not paid" tab counts with its own function instead of building the whole list.

drop function if exists public.search_parcels(text, integer);

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
  with base as (
    select p.* from public.parcels p
      left join public.applications a on a.id = p.application_id
     where p.deleted_at is null and p.status <> 'archived' and p.layout = 'house'
       and (p_neighbourhood is null or p.neighbourhood_id = p_neighbourhood)
       -- Partial registration: not registered yet; every other tab: registered land (Demolished: demolished only).
       and (p_stage is null
            or (p_stage = 'draft' and p.status in ('draft', 'surveyed', 'verified'))
            or (p_stage in ('registered', 'paid', 'owing', 'demolished') and p.status not in ('draft', 'surveyed', 'verified')))
       and (p_stage is distinct from 'demolished' or p.building_state = 'demolished')
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
  ), rows as (
    select p.id, p.pun, p.status, p.area_m2, d.name_so as district, n.name_so as neighbourhood,
           coalesce(
             (select string_agg(distinct pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                join public.parcels o on o.id = po.parcel_id
               where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null and o.status <> 'archived')) and po.valid_to is null),
             (select string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) from public.application_parties ap
                join public.parties pa on pa.id = ap.party_id
               where ap.application_id = p.application_id and ap.role in ('owner', 'co_owner'))) as owners,
           p.created_at, p.house_no, p.govt_receipt_no,
           (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
            order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1) as invoice,
           (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
             where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null)) and i.status in ('issued', 'partially_paid')) as balance,
           p.locked_at, p.lock_reason, a.number as application_number, d.name_en as district_en, n.name_en as neighbourhood_en,
           p.plot_no, p.building_state, p.parent_id
      from base p
      join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join public.applications a on a.id = p.application_id
  )
  select * from rows r
   where (p_stage is distinct from 'paid' or r.balance <= 0)
     and (p_stage is distinct from 'owing' or r.balance > 0)
   order by r.created_at desc
   limit least(greatest(p_limit, 1), 5000);
$$;
revoke all on function public.search_parcels(text, integer, text, uuid) from public, anon;
grant execute on function public.search_parcels(text, integer, text, uuid) to authenticated;

/** Registered, standing-or-demolished land (one row per house or flat) that has an unpaid bill: the "Not paid" tab. */
create or replace function public.parcel_owing_count()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*) from public.parcels p
   where p.deleted_at is null and p.layout = 'house' and p.status not in ('draft', 'surveyed', 'verified', 'archived')
     and exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid') and i.balance > 0);
$$;
revoke all on function public.parcel_owing_count() from public, anon;
grant execute on function public.parcel_owing_count() to authenticated;
