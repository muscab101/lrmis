-- Where to point the map for a neighbourhood: its own boundary when drawn; otherwise a point for it (its sector's
-- point, else its section's) and its district's boundary. Many neighbourhoods have no boundary yet, so Add land
-- still zooms to the right place. Runs as the caller (RLS applies).
create or replace function public.neighbourhood_view(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = extensions
as $$
  select jsonb_build_object(
    'neighbourhood', case when n.geom is not null then jsonb_build_object(
        'geometry', st_asgeojson(st_simplifypreservetopology(n.geom, 0.00001), 6)::jsonb,
        'bbox', array[st_xmin(n.geom), st_ymin(n.geom), st_xmax(n.geom), st_ymax(n.geom)]) end,
    'point', (select array[st_x(pt), st_y(pt)] from (select coalesce(s.point, sec.point) as pt) x where pt is not null),
    'district', case when d.geom is not null then jsonb_build_object(
        'geometry', st_asgeojson(st_simplifypreservetopology(d.geom, 0.00001), 6)::jsonb,
        'bbox', array[st_xmin(d.geom), st_ymin(d.geom), st_xmax(d.geom), st_ymax(d.geom)]) end)
  from public.neighbourhoods n
  left join public.sectors s on s.id = n.sector_id
  left join public.sections sec on sec.id = s.section_id
  left join public.districts d on d.id = n.district_id
  where n.id = p_id;
$$;
