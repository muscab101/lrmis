-- 4-corner land stays inside its neighbourhood (owner's request, 2026-11-23): when the neighbourhood has a drawn
-- boundary, the shape drawn for new land must lie inside it (1 m of slack for the border line itself); a shape that
-- crosses the border is refused with drawn_shape_outside. Neighbourhoods without a boundary are not checked.

create or replace function private.field_land_drawn(p jsonb, p_pin extensions.geometry, p_nbhd uuid)
returns extensions.geometry
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g extensions.geometry := private.field_land_drawn(p, p_pin);
  b extensions.geometry;
begin
  if g is null or p_nbhd is null then
    return g;
  end if;
  select n.geom into b from public.neighbourhoods n where n.id = p_nbhd;
  if b is not null and not extensions.st_covers(extensions.st_buffer(b::extensions.geography, 1)::extensions.geometry, g) then
    perform private.raise_app_error('VALIDATION', 'drawn_shape_outside');
  end if;
  return g;
end;
$$;

revoke all on function private.field_land_drawn(jsonb, extensions.geometry, uuid) from public, anon, authenticated;

do $do$
declare
  f text;
  d text;
  n text;
begin
  foreach f in array array['public.field_land_create(jsonb)', 'public.land_with_units_create(jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'if private.field_land_drawn(p, v_pin) is not null then', 'if private.field_land_drawn(p, v_pin, v_nbhd) is not null then');
    n := replace(n, 'set geom = private.field_land_drawn(p, v_pin),', 'set geom = private.field_land_drawn(p, v_pin, v_nbhd),');
    if n = d or position('field_land_drawn(p, v_pin, v_nbhd) is not null' in n) = 0 or position('geom = private.field_land_drawn(p, v_pin, v_nbhd)' in n) = 0 then
      raise exception '%: anchor not found', f;
    end if;
    execute n;
  end loop;
end;
$do$;
