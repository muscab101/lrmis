-- The map's land shapes say whether registered land still owes, so paid land can be drawn blue (like its house pin).
do $$
declare
  d text := pg_get_functiondef('public.parcel_tile(integer,integer,integer)'::regprocedure);
  a text := 'p.geom_provisional as provisional, p.building_state = ''demolished'' as demolished
      from public.parcels p';
  b text := 'p.geom_provisional as provisional, p.building_state = ''demolished'' as demolished,
             exists (select 1 from public.invoices i join public.parcels o on o.id = i.parcel_id
                      where (o.id = p.id or o.parent_id = p.id) and i.status in (''issued'', ''partially_paid'')) as owing
      from public.parcels p';
begin
  if position(a in d) = 0 then raise exception 'parcel_tile: text not found'; end if;
  execute replace(d, a, b);
end $$;
