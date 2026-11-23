-- Keep the drawn lines (owner's request, 2026-11-23): land registered with 4-corner drawing keeps the shape drawn as its
-- boundary, instead of the stand-in square made around the pin from width × length. The recorded size (width × length,
-- area_m2) stays what the surveyor typed and is still what the bills use; only the drawing on the map changes.
-- p.geom is a GeoJSON Polygon; without it nothing changes.

/** The shape drawn for new land (p.geom), checked: a closed shape near the pin, 1 m² to 1 km². Null when none. */
create or replace function private.field_land_drawn(p jsonb, p_pin extensions.geometry)
returns extensions.geometry
language plpgsql
stable
set search_path = ''
as $$
declare
  g extensions.geometry;
  v_m2 float8;
begin
  if p -> 'geom' is null or jsonb_typeof(p -> 'geom') <> 'object' then
    return null;
  end if;
  begin
    g := extensions.st_setsrid(extensions.st_geomfromgeojson((p -> 'geom')::text), 4326);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'drawn_shape');
  end;
  if extensions.geometrytype(g) <> 'POLYGON' or not extensions.st_isvalid(g)
     or extensions.st_npoints(g) not between 4 and 51 then
    perform private.raise_app_error('VALIDATION', 'drawn_shape');
  end if;
  v_m2 := extensions.st_area(g::extensions.geography);
  if v_m2 < 1 or v_m2 > 1000000 or not extensions.st_dwithin(g::extensions.geography, p_pin::extensions.geography, 50) then
    perform private.raise_app_error('VALIDATION', 'drawn_shape');
  end if;
  return g;
end;
$$;

revoke all on function private.field_land_drawn(jsonb, extensions.geometry) from public, anon, authenticated;

do $do$
declare
  d text;
  n text;
  pin_line text := $re$(v_pin := extensions\.st_setsrid\(extensions\.st_makepoint\(v_lon, v_lat\), 4326\);)$re$;
begin
  -- One house: check the shape first (before anything is saved), then put it on the land.
  d := pg_get_functiondef('public.field_land_create(jsonb)'::regprocedure);
  n := regexp_replace(d, pin_line, $rp$\1
  perform private.field_land_drawn(p, v_pin);$rp$);
  n := regexp_replace(n, $re$(\n\s*v_bills := private\.parcel_bill\(v_parcel\);)$re$, $rp$
  if private.field_land_drawn(p, v_pin) is not null then
    update public.parcels set geom = private.field_land_drawn(p, v_pin), geom_provisional = false where id = v_parcel;
  end if;\1$rp$);
  if n = d or position('field_land_drawn(p, v_pin) is not null' in n) = 0 or position('perform private.field_land_drawn' in n) = 0 then
    raise exception 'field_land_create: anchor not found';
  end if;
  execute n;

  -- Flats or a compound: the building and its units share the drawn shape.
  d := pg_get_functiondef('public.land_with_units_create(jsonb)'::regprocedure);
  n := regexp_replace(d, pin_line, $rp$\1
  perform private.field_land_drawn(p, v_pin);$rp$);
  n := regexp_replace(n, $re$(\n\s*perform private\.flats_apportion\(v_parent\);)$re$, $rp$
  if private.field_land_drawn(p, v_pin) is not null then
    update public.parcels set geom = private.field_land_drawn(p, v_pin), geom_provisional = false
     where id = v_parent or parent_id = v_parent;
  end if;\1$rp$);
  if n = d or position('field_land_drawn(p, v_pin) is not null' in n) = 0 or position('perform private.field_land_drawn' in n) = 0 then
    raise exception 'land_with_units_create: anchor not found';
  end if;
  execute n;
end;
$do$;
