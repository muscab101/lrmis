-- The citizen's property cards show the house number after the neighbourhood.
do $$
declare
  d text := pg_get_functiondef('public.citizen_overview()'::regprocedure);
  a text := '''land_use'', pc.land_use, ''area_m2'', pc.area_m2,';
begin
  if position(a in d) = 0 then
    raise exception 'citizen_overview: anchor not found';
  end if;
  execute replace(d, a, '''land_use'', pc.land_use, ''area_m2'', pc.area_m2, ''house_no'', pc.house_no,');
end $$;
