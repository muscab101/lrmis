-- Faster land map tiles (2026-11-28): zoomed out, one tile held every house's outline and pin (3 MB, over a second).
-- • House outlines are sent only from zoom 16 (the staff map draws pins; outlines are only worth drawing up close).
-- • "Still owing" on each pin: two indexed look-ups (its own bills, then its flats' bills) instead of one join with an
--   OR that could not use an index.
-- • The pin is the stored centre (parcels.centroid, the same rule since 0302) instead of working it out again.

do $do$
declare
  d text := pg_get_functiondef('public.parcel_tile(int,int,int)'::regprocedure);
  a_owing text := $a$exists (select 1 from public.invoices i join public.parcels o on o.id = i.parcel_id
                      where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid'))$a$;
  a_owing2 text := $a$exists (select 1 from public.invoices i join public.parcels o on o.id = i.parcel_id
                    where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid'))$a$;
  b_owing text := $b$(exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid'))
              or exists (select 1 from public.parcels o join public.invoices i on i.parcel_id = o.id
                          where o.parent_id = p.id and i.status in ('issued', 'partially_paid')))$b$;
  a_zoom text := 'if p_z >= 13 then';
  a_pin text := 'st_transform(case when st_contains(p.geom, st_centroid(p.geom)) then st_centroid(p.geom) else st_pointonsurface(p.geom) end, 3857)';
begin
  if position(a_owing in d) = 0 or position(a_owing2 in d) = 0 or position(a_zoom in d) = 0 or position(a_pin in d) = 0 then
    raise exception 'parcel_tile: anchor not found';
  end if;
  d := replace(d, a_owing, b_owing);
  d := replace(d, a_owing2, b_owing);
  d := replace(d, a_zoom, 'if p_z >= 16 then');
  d := replace(d, a_pin, 'st_transform(p.centroid, 3857)');
  execute d;
end $do$;
