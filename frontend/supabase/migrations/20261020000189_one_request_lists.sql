-- Faster "Yet to register": Banaadir has ~5,300 neighbourhoods and the API hands back at most 1,000 rows at a time,
-- so these lists were read in 6 rounds one after another (and the status list was worked out again for every round).
-- Each list now comes back whole in one answer.

-- Every neighbourhood's land count, in one answer (same rules as neighbourhood_registration_status).
create or replace function public.neighbourhood_registration_status_all(p_district uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.neighbourhood_registration_status(p_district) r;
$$;
revoke all on function public.neighbourhood_registration_status_all(uuid) from public, anon;
grant execute on function public.neighbourhood_registration_status_all(uuid) to authenticated;

-- Sections, sectors and neighbourhoods (with capacity) of some districts, for the place pickers, in one answer.
-- Runs as the person (security invoker), so it shows exactly what they could read themselves.
create or replace function public.zone_places_all(p_districts uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'parent', s.district_id, 'code', s.code, 'name_so', s.name_so, 'name_en', s.name_en) order by s.code)
                            from public.sections s where s.district_id = any (p_districts) and s.deleted_at is null), '[]'::jsonb),
    'sectors', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'parent', k.section_id, 'code', k.code, 'name_so', k.name_so, 'name_en', k.name_en) order by k.code)
                           from public.sectors k where k.district_id = any (p_districts) and k.deleted_at is null), '[]'::jsonb),
    'neighbourhoods', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'parent', n.sector_id, 'code', n.code, 'name_so', n.name_so, 'name_en', n.name_en, 'capacity', n.capacity) order by n.code, n.id)
                                  from public.neighbourhoods n where n.district_id = any (p_districts) and n.deleted_at is null), '[]'::jsonb));
$$;
revoke all on function public.zone_places_all(uuid[]) from public, anon;
grant execute on function public.zone_places_all(uuid[]) to authenticated;

-- The land counts per neighbourhood in one pass (grouped), not three separate counts for each of ~5,300 neighbourhoods.
create or replace function public.neighbourhood_registration_status(p_district uuid default null)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               has_boundary boolean, partial bigint, open_applications bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('parcels.yet_to_register') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.yet_to_register');
  end if;
  return query
    with land as (
      select p.neighbourhood_id as nid,
             count(*) filter (where p.layout = 'house' and p.status in ('draft', 'surveyed', 'verified')) as partial,
             count(*) filter (where p.parent_id is null and p.status in ('registered', 'disputed')) as registered
        from public.parcels p
       where p.deleted_at is null and p.neighbourhood_id is not null
       group by p.neighbourhood_id
    ), apps as (
      select a.neighbourhood_id as nid, count(*) as open_applications
        from public.applications a
       where a.neighbourhood_id is not null and a.status not in ('approved', 'rejected', 'cancelled')
       group by a.neighbourhood_id
    )
    select n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, coalesce(n.has_geom, false),
           coalesce(l.partial, 0), coalesce(ap.open_applications, 0), coalesce(l.registered, 0)
      from public.neighbourhoods n
      join public.districts d on d.id = n.district_id
      left join land l on l.nid = n.id
      left join apps ap on ap.nid = n.id
     where n.deleted_at is null and d.deleted_at is null
       and public.can_access_district(d.id) and (p_district is null or d.id = p_district)
     order by d.name_en, n.code;
end;
$$;
