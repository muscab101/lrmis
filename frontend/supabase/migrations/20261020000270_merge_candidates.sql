-- Merge: the plots that touch this land in the same neighbourhood, with their owners and whether they match,
-- so staff pick them from a list instead of typing land numbers. Staff who may view the land (and its district) see
-- the neighbours' owner names, as they would on each land page.

create or replace function public.parcel_merge_candidates(p_parcel uuid)
returns table (
  id uuid,
  pun text,
  house_no text,
  area_m2 numeric,
  land_use text,
  status text,
  owners jsonb,
  same_owners boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_district uuid;
begin
  perform private.assert_permission('parcels.view');
  select p.district_id into v_district from public.parcels p where p.id = p_parcel and p.deleted_at is null;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return query
  with me as (
    select p.id, p.geom, p.neighbourhood_id from public.parcels p
    where p.id = p_parcel and p.geom is not null and p.deleted_at is null
  ),
  sig as (
    select po.parcel_id, string_agg(po.party_id::text || ':' || coalesce(po.share_pct, 0)::text, ',' order by po.party_id) s
    from public.parcel_owners po where po.valid_to is null group by po.parcel_id
  ),
  near as (
    select c.* from public.parcels c, me
    where c.id <> me.id
      and c.deleted_at is null
      and c.parent_id is null
      and c.status::text not in ('archived', 'draft')
      and c.neighbourhood_id = me.neighbourhood_id
      and c.geom is not null
      and extensions.st_dwithin(c.geom, me.geom, 0.000005)
    order by c.pun
    limit 30
  )
  select n.id, n.pun::text, n.house_no::text, n.area_m2::numeric, n.land_use::text, n.status::text,
    coalesce((select jsonb_agg(jsonb_build_object('name', pa.full_name, 'share', po.share_pct) order by po.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners po join public.parties pa on pa.id = po.party_id
              where po.parcel_id = n.id and po.valid_to is null), '[]'::jsonb),
    coalesce((select s from sig where sig.parcel_id = n.id) = (select s from sig where sig.parcel_id = p_parcel), false)
  from near n;
end;
$$;

revoke all on function public.parcel_merge_candidates(uuid) from public, anon;
grant execute on function public.parcel_merge_candidates(uuid) to authenticated;
