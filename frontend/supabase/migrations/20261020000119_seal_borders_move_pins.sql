-- 1. Seal the zero-width cuts that joining outlines left inside some districts (the map drew them as broken lines
--    inside Dayniile, Kaaraan, Kaxda and Yaaqshiid when zoomed in): close each outline by 3 m, never onto a neighbour.
-- 2. Section and sector pins that lie inside another district move just inside their own district (150 m in from its
--    edge, at the nearest such point). Where they were is kept in point_moved_from, and location_pins says `moved`
--    so the map draws them differently (approximate places, owner request 2026-10-26).
do $$
declare
  r record;
  v_closed extensions.geometry;
begin
  for r in select id, geom from public.districts where geom is not null and deleted_at is null loop
    v_closed := extensions.st_buffer(extensions.st_buffer(r.geom::extensions.geography, 3)::extensions.geography, -3)::extensions.geometry;
    if extensions.st_length(extensions.st_boundary(r.geom)::extensions.geography)
       - extensions.st_length(extensions.st_boundary(v_closed)::extensions.geography) > 100 then
      v_closed := extensions.st_difference(v_closed,
        coalesce((select extensions.st_union(o.geom) from public.districts o where o.id <> r.id and o.geom is not null and o.deleted_at is null),
                 'GEOMETRYCOLLECTION EMPTY'::extensions.geometry));
      update public.districts set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(v_closed), 3)), updated_at = now()
       where id = r.id;
    end if;
  end loop;
exception when undefined_function then
  raise notice 'border sealing skipped: %', sqlerrm;
end;
$$;

alter table public.sections add column if not exists point_moved_from extensions.geometry(Point, 4326);
alter table public.sectors add column if not exists point_moved_from extensions.geometry(Point, 4326);

/** The nearest point at least 150 m inside a district (its surface point when it is too small for that). */
create or replace function private.point_inside(p_point extensions.geometry, p_area extensions.geometry)
returns extensions.geometry
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select extensions.st_closestpoint(s, p_point) from
       (select extensions.st_buffer(p_area::extensions.geography, -150)::extensions.geometry s) x
      where not extensions.st_isempty(s)),
    extensions.st_pointonsurface(p_area));
$$;
revoke all on function private.point_inside(extensions.geometry, extensions.geometry) from public, anon, authenticated;

update public.sections s
   set point_moved_from = s.point, point = private.point_inside(s.point, d.geom)
  from public.districts d
 where d.id = s.district_id and d.geom is not null and s.point is not null and s.point_moved_from is null
   and not extensions.st_contains(d.geom, s.point);

update public.sectors t
   set point_moved_from = t.point, point = private.point_inside(t.point, d.geom)
  from public.districts d
 where d.id = t.district_id and d.geom is not null and t.point is not null and t.point_moved_from is null
   and not extensions.st_contains(d.geom, t.point);

create or replace function public.location_pins()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(f), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'type', 'Feature',
               'geometry', extensions.st_asgeojson(s.point)::jsonb,
               'properties', jsonb_build_object(
                 'id', s.id, 'level', 'section', 'code', s.code, 'name_so', s.name_so, 'name_en', s.name_en,
                 'district_id', s.district_id, 'district_name_so', d.name_so,
                 'confidence', s.point_confidence, 'source', s.point_source,
                 'moved', s.point_moved_from is not null)) as f
        from public.sections s
        join public.districts d on d.id = s.district_id
       where s.point is not null and s.deleted_at is null
      union all
      select jsonb_build_object(
               'type', 'Feature',
               'geometry', extensions.st_asgeojson(coalesce(t.point, s.point))::jsonb,
               'properties', jsonb_build_object(
                 'id', t.id, 'level', 'sector', 'name_so', t.name_so, 'name_en', t.name_en,
                 'section_id', t.section_id, 'district_id', t.district_id, 'district_name_so', d.name_so,
                 'inherited', t.point is null,
                 'confidence', coalesce(t.point_confidence, s.point_confidence),
                 'source', coalesce(t.point_source, 'inherited from section ' || s.name_so),
                 'moved', case when t.point is null then s.point_moved_from is not null else t.point_moved_from is not null end))
        from public.sectors t
        join public.sections s on s.id = t.section_id
        join public.districts d on d.id = t.district_id
       where coalesce(t.point, s.point) is not null and t.deleted_at is null
    ) pins;
$$;

-- Moved pins that landed on the same spot are spread on a 150 m ring around it (kept only where still inside the
-- district), so each one can be seen and clicked.
with grp as (
  select s.id, s.district_id, s.point,
         row_number() over (partition by extensions.st_astext(s.point) order by s.name_en) - 1 i,
         count(*) over (partition by extensions.st_astext(s.point)) n
    from public.sections s where s.point_moved_from is not null
), spread as (
  select g.id, extensions.st_project(g.point::extensions.geography, 150, radians(360.0 * g.i / g.n))::extensions.geometry p, g.district_id
    from grp g where g.n > 1
)
update public.sections s set point = sp.p
  from spread sp join public.districts d on d.id = sp.district_id
 where s.id = sp.id and extensions.st_contains(d.geom, sp.p);
