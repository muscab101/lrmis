-- The pin of every land sits in the true middle of its shape (owner's request, 2026-11-28): the centre of area, or a
-- point inside the shape when that centre falls outside (an L-shaped house). Before, it was always "a point inside",
-- which on a plain rectangle could sit 1–2 m off the middle.
alter table public.parcels alter column centroid set expression as (
  case when extensions.st_contains(geom, extensions.st_centroid(geom)) then extensions.st_centroid(geom)
       else extensions.st_pointonsurface(geom) end);
