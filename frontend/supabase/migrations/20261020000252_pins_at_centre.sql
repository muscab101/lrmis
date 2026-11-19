-- House pins stand at the middle of the plot (its centroid), or a point inside it when the middle falls outside (an L shape).
do $$
declare
  d text := pg_get_functiondef('public.parcel_tile(integer,integer,integer)'::regprocedure);
  a text := 'st_asmvtgeom(st_transform(st_pointonsurface(p.geom), 3857), v_env)';
  b text := 'st_asmvtgeom(st_transform(case when st_contains(p.geom, st_centroid(p.geom)) then st_centroid(p.geom) else st_pointonsurface(p.geom) end, 3857), v_env)';
begin
  if position(a in d) = 0 then raise exception 'parcel_tile: text not found'; end if;
  execute replace(d, a, b);
end $$;
