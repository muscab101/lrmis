-- The citizen sees when each property's next yearly tax bill comes (its anniversary, see 0233).
do $$
declare
  d text := pg_get_functiondef('public.citizen_overview()'::regprocedure);
  a text := '''house_no'', pc.house_no,';
begin
  if position(a in d) = 0 then
    raise exception 'citizen_overview: anchor not found';
  end if;
  execute replace(d, a, a || ' ''next_bill'', case when pc.tax_anniversary is not null and pc.building_state is distinct from ''demolished'' then private.next_anniversary(pc.tax_anniversary) end,');
end $$;
