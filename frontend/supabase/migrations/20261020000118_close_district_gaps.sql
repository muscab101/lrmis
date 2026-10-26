-- Close the gaps between districts: every hole in the union of all district boundaries (slivers where neighbouring
-- outlines don't quite meet, the seams left inside Dayniile by 0117, and the strip between Heliwaa's two parts) goes
-- to the district it shares the longest border with. Afterwards no land inside the outer edge belongs to no district.
do $$
begin
  with u as (
    select extensions.st_union(geom) g from public.districts where geom is not null and deleted_at is null
  ), holes as (
    select extensions.st_makepolygon(extensions.st_interiorringn(p.geom, i)) h
      from u, extensions.st_dump(u.g) p, generate_series(1, extensions.st_numinteriorrings(p.geom)) i
  ), best as (
    select distinct on (h.h) h.h, d.id district_id
      from holes h
      join public.districts d on d.geom is not null and d.deleted_at is null and extensions.st_dwithin(d.geom, h.h, 0.00002)
     order by h.h, extensions.st_length(extensions.st_intersection(extensions.st_exteriorring(h.h), extensions.st_buffer(d.geom, 0.00002))::extensions.geography) desc
  ), per as (
    select district_id, extensions.st_union(h) g from best group by district_id
  )
  update public.districts d
     set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_union(d.geom, p.g)), 3)),
         updated_at = now()
    from per p
   where p.district_id = d.id;
end;
$$;

-- Crumbs: pieces under 100 m² that touched a district only at a corner become no separate part of it.
update public.districts d
   set geom = extensions.st_multi((select extensions.st_union(g.geom) from extensions.st_dump(d.geom) g
                                    where extensions.st_area(g.geom::extensions.geography) >= 100)),
       updated_at = now()
 where d.geom is not null and extensions.st_numgeometries(d.geom) > 1
   and exists (select 1 from extensions.st_dump(d.geom) g where extensions.st_area(g.geom::extensions.geography) < 100);
