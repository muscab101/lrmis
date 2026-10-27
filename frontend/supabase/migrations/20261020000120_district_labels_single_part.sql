-- 1. A district is one piece: smaller detached pieces (Heliwaa's patch north of Daarusalaam, left by the gap fill in
--    0117) go to the neighbour they share the longest border with; pins of the district that then lie outside it move
--    just inside it (as in 0119).
-- 2. One label per district: the map labelled every tile's piece of a district, so names showed two or three times.
--    districts.label_point (the middle of its largest piece, kept up to date by a trigger) is sent with the district
--    tiles as its own layer, district_labels, and the map labels those points.

-- 1.
do $$
declare
  r record;
  v_to uuid;
begin
  for r in
    select d.id, p.geom part
      from public.districts d, lateral (select (extensions.st_dump(d.geom)).geom) p
     where d.geom is not null and d.deleted_at is null and extensions.st_numgeometries(d.geom) > 1
       and extensions.st_area(p.geom) < (select max(extensions.st_area(g.geom)) from extensions.st_dump(d.geom) g)
  loop
    select o.id into v_to from public.districts o
     where o.id <> r.id and o.geom is not null and o.deleted_at is null and extensions.st_dwithin(o.geom, r.part, 0.00002)
     order by extensions.st_length(extensions.st_intersection(extensions.st_boundary(r.part), extensions.st_buffer(o.geom, 0.00002))::extensions.geography) desc
     limit 1;
    continue when v_to is null;
    update public.districts set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_difference(geom, r.part)), 3)), updated_at = now()
     where id = r.id;
    update public.districts set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_union(geom, r.part)), 3)), updated_at = now()
     where id = v_to;
  end loop;
end;
$$;

update public.sections s
   set point_moved_from = coalesce(s.point_moved_from, s.point), point = private.point_inside(s.point, d.geom)
  from public.districts d
 where d.id = s.district_id and d.geom is not null and s.point is not null and not extensions.st_contains(d.geom, s.point);
update public.sectors t
   set point_moved_from = coalesce(t.point_moved_from, t.point), point = private.point_inside(t.point, d.geom)
  from public.districts d
 where d.id = t.district_id and d.geom is not null and t.point is not null and not extensions.st_contains(d.geom, t.point);

-- 2.
alter table public.districts add column if not exists label_point extensions.geometry(Point, 4326);

/** Where a district's name goes: the centre of the largest circle that fits in its largest piece. */
create or replace function private.district_label_point(p_geom extensions.geometry)
returns extensions.geometry
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_part extensions.geometry;
begin
  if p_geom is null or extensions.st_isempty(p_geom) then
    return null;
  end if;
  select g.geom into v_part from extensions.st_dump(p_geom) g order by extensions.st_area(g.geom) desc limit 1;
  begin
    return (extensions.st_maximuminscribedcircle(v_part)).center;
  exception when undefined_function then
    return extensions.st_pointonsurface(v_part);
  end;
end;
$$;
revoke all on function private.district_label_point(extensions.geometry) from public, anon, authenticated;

create or replace function private.district_set_label_point()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.label_point := private.district_label_point(new.geom);
  return new;
end;
$$;
revoke all on function private.district_set_label_point() from public, anon, authenticated;
drop trigger if exists district_label_point on public.districts;
create trigger district_label_point before insert or update of geom on public.districts
  for each row execute function private.district_set_label_point();
update public.districts set label_point = private.district_label_point(geom) where geom is not null;

create or replace function public.location_tile(p_layer text, p_z integer, p_x integer, p_y integer)
returns bytea
language plpgsql
stable
security definer
set search_path = 'extensions'
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v_env4326 geometry := st_transform(v_env, 4326);
  v_tol double precision := case when p_z < 12 then 0.0005 when p_z < 15 then 0.00005 else 0 end;
  v bytea;
  v_labels bytea;
begin
  if p_z < 0 or p_z > 22 then
    return ''::bytea;
  end if;

  case p_layer
    when 'districts' then
      select st_asmvt(t.*, 'districts') into v from (
        select st_asmvtgeom(st_transform(st_simplifypreservetopology(d.geom, v_tol), 3857), v_env) as geom,
               d.id::text as id, d.code, d.name_so, d.name_en
        from public.districts d where d.deleted_at is null and d.geom && v_env4326) t;
      -- One name per district: its label point travels in only the tile that holds it.
      select st_asmvt(t.*, 'district_labels') into v_labels from (
        select st_asmvtgeom(st_transform(d.label_point, 3857), v_env) as geom,
               d.id::text as id, d.code, d.name_so, d.name_en
        from public.districts d where d.deleted_at is null and d.label_point is not null and st_intersects(d.label_point, v_env4326)) t;
      v := coalesce(v, ''::bytea) || coalesce(v_labels, ''::bytea);
    when 'sections' then
      if p_z < 11 then return ''::bytea; end if;
      select st_asmvt(t.*, 'sections') into v from (
        select st_asmvtgeom(st_transform(st_simplifypreservetopology(s.geom, v_tol), 3857), v_env) as geom,
               s.id::text as id, s.code, s.name_so, s.name_en, s.district_id::text as district_id
        from public.sections s where s.deleted_at is null and s.geom && v_env4326) t;
    when 'sectors' then
      if p_z < 12 then return ''::bytea; end if;
      select st_asmvt(t.*, 'sectors') into v from (
        select st_asmvtgeom(st_transform(st_simplifypreservetopology(s.geom, v_tol), 3857), v_env) as geom,
               s.id::text as id, s.code, s.name_so, s.name_en, s.district_id::text as district_id
        from public.sectors s where s.deleted_at is null and s.geom && v_env4326) t;
    when 'neighbourhoods' then
      if p_z < 12 then return ''::bytea; end if;
      select st_asmvt(t.*, 'neighbourhoods') into v from (
        select st_asmvtgeom(st_transform(st_simplifypreservetopology(n.geom, v_tol), 3857), v_env) as geom,
               n.id::text as id, n.code, n.name_so, n.name_en, n.capacity,
               n.district_id::text as district_id, d.code as district_code, d.name_so as district_name_so
        from public.neighbourhoods n join public.districts d on d.id = n.district_id
        where n.deleted_at is null and n.geom && v_env4326) t;
    when 'streets' then
      if p_z < 13 then return ''::bytea; end if;
      select st_asmvt(t.*, 'streets') into v from (
        select st_asmvtgeom(st_transform(s.geom, 3857), v_env) as geom, s.id::text as id, s.name_so, s.name_en
        from public.streets s where s.deleted_at is null and s.geom && v_env4326) t;
    when 'facilities' then
      if p_z < 13 then return ''::bytea; end if;
      select st_asmvt(t.*, 'facilities') into v from (
        select st_asmvtgeom(st_transform(f.geom, 3857), v_env) as geom, f.id::text as id, f.kind::text as kind,
               f.name_so, f.name_en
        from public.facilities f where f.deleted_at is null and f.geom && v_env4326) t;
    else
      perform private.raise_app_error('VALIDATION', 'layer');
  end case;
  return coalesce(v, ''::bytea);
end;
$$;

-- A piece handed over above may meet its new district only along a zero-width line, which keeps them two parts:
-- seal such joins by 1 m (never onto a neighbour). The label trigger moves the name to the joined shape.
do $$
declare
  r record;
  v_closed extensions.geometry;
begin
  for r in select id, geom from public.districts where geom is not null and deleted_at is null and extensions.st_numgeometries(geom) > 1 loop
    v_closed := extensions.st_buffer(extensions.st_buffer(r.geom::extensions.geography, 1)::extensions.geography, -1)::extensions.geometry;
    continue when extensions.st_numgeometries(v_closed) >= extensions.st_numgeometries(r.geom);
    v_closed := extensions.st_difference(v_closed,
      coalesce((select extensions.st_union(o.geom) from public.districts o where o.id <> r.id and o.geom is not null and o.deleted_at is null),
               'GEOMETRYCOLLECTION EMPTY'::extensions.geometry));
    update public.districts set geom = extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(v_closed), 3)), updated_at = now()
     where id = r.id;
  end loop;
exception when undefined_function then
  raise notice 'join sealing skipped: %', sqlerrm;
end;
$$;
