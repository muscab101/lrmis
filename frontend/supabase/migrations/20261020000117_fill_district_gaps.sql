-- The map showed section / sector pins in land no district covered: Daarusalaam and Gubadley have no mapped boundary,
-- and some Dayniile and Heliwaa pins lie beyond their boundary. Fill the uncovered land around Mogadishu (within the
-- outline of all districts and pins) between the pins standing in it: each piece goes to the district of its nearest
-- pin (Voronoi), cut exactly along the existing borders; strips narrower than ~800 m are dropped, and only pieces that
-- hold one of that district's own pins are kept. Approximate boundaries (owner request 2026-10-26: "just fill the borders"); replace them with surveyed ones
-- when they exist. Districts whose pins all lie inside other districts (Garasbaaley) stay without a boundary.
do $$
begin
  with pins as (
    select s.district_id, s.point pt from public.sections s where s.point is not null
    union all
    select s.district_id, coalesce(k.point, s.point) from public.sectors k join public.sections s on s.id = k.section_id
     where coalesce(k.point, s.point) is not null
  ), mapped as (
    select extensions.st_union(geom) g from public.districts where geom is not null and deleted_at is null
  ), region as (
    select extensions.st_buffer(extensions.st_convexhull(extensions.st_collect((select g from mapped), extensions.st_collect(pt)))::extensions.geography, 300)::extensions.geometry g
      from pins
  ), gap as (
    select extensions.st_difference((select g from region), (select g from mapped)) g
  ), gappins as (
    select distinct on (pt) district_id, pt from pins, gap where extensions.st_contains(gap.g, pt)
  ), cells as (
    select (extensions.st_dump(extensions.st_voronoipolygons(extensions.st_collect(pt), 0, (select g from region)))).geom cell from gappins
  ), labelled as (
    select gp.district_id, extensions.st_intersection(c.cell, (select g from gap)) g
      from cells c join gappins gp on extensions.st_contains(c.cell, gp.pt)
  ), opened as (
    -- Drop strips narrower than ~800 m (the outline also runs along the shore, into the sea).
    select district_id,
           extensions.st_intersection(
             extensions.st_buffer(extensions.st_buffer(extensions.st_union(g)::extensions.geography, -400)::extensions.geography, 400)::extensions.geometry,
             (select g from gap)) g
      from labelled group by district_id
  ), parts as (
    select district_id, (extensions.st_dump(g)).geom g from opened
  ), kept as (
    select district_id, extensions.st_union(g) g from parts pa
     where exists (select 1 from gappins gp where gp.district_id = pa.district_id and extensions.st_contains(pa.g, gp.pt))
     group by district_id
  )
  update public.districts d
     set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(
                  case when d.geom is null then k.g else extensions.st_union(d.geom, k.g) end), 3)),
         updated_at = now()
    from kept k
   where k.district_id = d.id;
exception when undefined_function then
  -- Test databases without GEOS Voronoi support have no district outlines to fill anyway.
  raise notice 'district gap fill skipped: %', sqlerrm;
end;
$$;
