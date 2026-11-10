-- The map's neighbourhood search: a neighbourhood with no boundary drawn yet zooms to the land recorded in it. This is
-- the box around that land (west, south, east, north), or null when it has none. Runs as the person, so it only sees
-- the land they may see.

create or replace function public.neighbourhood_land_bbox(p_id uuid)
returns double precision[]
language sql
stable
security invoker
set search_path = ''
as $$
  select case when e.b is null then null
              else array[extensions.st_xmin(e.b::extensions.box3d), extensions.st_ymin(e.b::extensions.box3d),
                         extensions.st_xmax(e.b::extensions.box3d), extensions.st_ymax(e.b::extensions.box3d)] end
    from (select extensions.st_extent(p.geom) as b
            from public.parcels p
           where p.neighbourhood_id = p_id and p.deleted_at is null and p.geom is not null) e;
$$;
revoke all on function public.neighbourhood_land_bbox(uuid) from public, anon;
grant execute on function public.neighbourhood_land_bbox(uuid) to authenticated;
