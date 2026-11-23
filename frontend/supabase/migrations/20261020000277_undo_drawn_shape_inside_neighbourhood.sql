-- Undo 0276 (owner's request, 2026-11-23): 4-corner land is no longer limited to its neighbourhood boundary. The land
-- functions go back to the 0275 check (a closed shape near the pin, up to 1 km²) and the 3-argument check is dropped.

do $do$
declare
  f text;
  d text;
  n text;
begin
  foreach f in array array['public.field_land_create(jsonb)', 'public.land_with_units_create(jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'private.field_land_drawn(p, v_pin, v_nbhd)', 'private.field_land_drawn(p, v_pin)');
    if n = d then
      raise exception '%: anchor not found', f;
    end if;
    execute n;
  end loop;
end;
$do$;

drop function if exists private.field_land_drawn(jsonb, extensions.geometry, uuid);
