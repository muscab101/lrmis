-- Building outlines for placing land (owner's request, 2026-11-27): the surveyor puts the pin roughly on a house and
-- the system moves it to the middle of that house's roof and takes the roof as the land's outline.
-- The outlines come from Google Open Buildings (CC BY-4.0, "Google Open Buildings" credited on the map), loaded once
-- for Banadir into private.building_outlines by scripts/import-open-buildings.mjs. Until they are loaded, nothing is
-- found and the land form falls back to a box of width × length around the pin.

create table if not exists private.building_outlines (
  id bigint generated always as identity primary key,
  geom extensions.geometry(Polygon, 4326) not null,
  centre extensions.geometry(Point, 4326) not null,
  area_m2 real not null,
  confidence real,
  source text not null default 'google-open-buildings-v3'
);
create index if not exists building_outlines_geom_idx on private.building_outlines using gist (geom);
revoke all on private.building_outlines from public, anon, authenticated;

/**
 * The roof under a point (or the nearest within 3 m), for the land form: its outline (at most 50 corners), its middle
 * and size. Null when none is known there. Only for staff who may draw land (map.draw_corners).
 */
create or replace function public.building_at(p_lon double precision, p_lat double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pt extensions.geometry := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326);
  b private.building_outlines;
  v_geom extensions.geometry;
begin
  perform private.assert_permission('map.draw_corners');
  if p_lon is null or p_lat is null or abs(p_lat) > 90 or abs(p_lon) > 180 then
    return null;
  end if;
  select * into b from private.building_outlines o
   -- A small box around the point first (uses the index), then the real 3 m test.
   where o.geom operator(extensions.&&) extensions.st_expand(v_pt, 0.00005)
     and extensions.st_dwithin(o.geom::extensions.geography, v_pt::extensions.geography, 3)
   order by extensions.st_contains(o.geom, v_pt) desc, extensions.st_distance(o.geom::extensions.geography, v_pt::extensions.geography)
   limit 1;
  if b.id is null then
    return null;
  end if;
  v_geom := b.geom;
  -- The land form keeps at most 50 corners.
  if extensions.st_npoints(v_geom) > 51 then
    v_geom := extensions.st_simplifypreservetopology(v_geom, 0.000005);
  end if;
  if extensions.st_npoints(v_geom) > 51 then
    v_geom := extensions.st_orientedenvelope(b.geom);
  end if;
  return jsonb_build_object(
    'id', b.id,
    'outline', extensions.st_asgeojson(v_geom, 7)::jsonb,
    'centre', jsonb_build_array(round(extensions.st_x(b.centre)::numeric, 7), round(extensions.st_y(b.centre)::numeric, 7)),
    'area_m2', round(b.area_m2::numeric, 1),
    'confidence', b.confidence);
end;
$$;

revoke all on function public.building_at(double precision, double precision) from public, anon;
grant execute on function public.building_at(double precision, double precision) to authenticated;

/** How many outlines are loaded (for the import script and the health page). */
create or replace function public.building_outlines_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from private.building_outlines;
$$;
revoke all on function public.building_outlines_count() from public, anon;
grant execute on function public.building_outlines_count() to authenticated, service_role;

/**
 * Load a batch of outlines (the import script, with the service key): [{"wkt": "POLYGON((…))", "confidence": 0.8}, …].
 * The middle is the centre of area, or a point inside the roof when that falls outside (an L-shaped house).
 * Only the service role may call it (see the grant below).
 */
create or replace function public.building_outlines_load(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into private.building_outlines (geom, centre, area_m2, confidence)
  select g, case when extensions.st_contains(g, extensions.st_centroid(g)) then extensions.st_centroid(g) else extensions.st_pointonsurface(g) end,
         extensions.st_area(g::extensions.geography), c
    from (select (extensions.st_dump(extensions.st_makevalid(extensions.st_setsrid(extensions.st_geomfromtext(r ->> 'wkt'), 4326)))).geom as g,
                 (r ->> 'confidence')::real as c
            from jsonb_array_elements(p_rows) r) x
   where extensions.geometrytype(g) = 'POLYGON' and extensions.st_area(g::extensions.geography) >= 4;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.building_outlines_load(jsonb) from public, anon, authenticated;
grant execute on function public.building_outlines_load(jsonb) to service_role;
