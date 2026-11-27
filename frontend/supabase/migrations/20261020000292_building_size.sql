-- The roof under the pin also gives its size (owner's request, 2026-11-27): when the surveyor's pin lands on a house,
-- the land form takes the roof's width and length (the sides of the smallest rectangle around the roof, in metres,
-- the shorter side being the width) and its direction, and puts the pin in the roof's middle.

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
  v_env extensions.geometry;
  p1 extensions.geometry;
  p2 extensions.geometry;
  p3 extensions.geometry;
  a float8;
  c float8;
  v_angle float8;
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

  -- The size: the two sides of the smallest rectangle around the roof.
  v_env := extensions.st_orientedenvelope(b.geom);
  if extensions.geometrytype(v_env) = 'POLYGON' then
    p1 := extensions.st_pointn(extensions.st_exteriorring(v_env), 1);
    p2 := extensions.st_pointn(extensions.st_exteriorring(v_env), 2);
    p3 := extensions.st_pointn(extensions.st_exteriorring(v_env), 3);
    a := extensions.st_distance(p1::extensions.geography, p2::extensions.geography);
    c := extensions.st_distance(p2::extensions.geography, p3::extensions.geography);
    -- The direction of the width side, in degrees from east (0–179), so a box drawn later faces the same way.
    v_angle := case when a <= c then degrees(atan2((extensions.st_y(p2) - extensions.st_y(p1)) * 110540,
                                                    (extensions.st_x(p2) - extensions.st_x(p1)) * 111320 * cos(radians(extensions.st_y(p1)))))
                    else degrees(atan2((extensions.st_y(p3) - extensions.st_y(p2)) * 110540,
                                       (extensions.st_x(p3) - extensions.st_x(p2)) * 111320 * cos(radians(extensions.st_y(p2))))) end;
    v_angle := mod(mod(round(v_angle)::numeric, 180) + 180, 180);
  end if;

  return jsonb_build_object(
    'id', b.id,
    'outline', extensions.st_asgeojson(v_geom, 7)::jsonb,
    'centre', jsonb_build_array(round(extensions.st_x(b.centre)::numeric, 7), round(extensions.st_y(b.centre)::numeric, 7)),
    'area_m2', round(b.area_m2::numeric, 1),
    'width_m', round(least(a, c)::numeric, 1),
    'length_m', round(greatest(a, c)::numeric, 1),
    'angle', v_angle,
    'confidence', b.confidence);
end;
$$;

revoke all on function public.building_at(double precision, double precision) from public, anon;
grant execute on function public.building_at(double precision, double precision) to authenticated;
