-- The map shows a pin on every registered house. parcel_tile now also sends a "parcel_pins" layer (one point inside
-- each registered parcel, with its id, PUN and House No) from zoom 11, so the pins show before the shapes do (13+).

create or replace function public.parcel_tile(p_z int, p_x int, p_y int)
returns bytea
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v bytea;
  v_pins bytea;
  v_all boolean;
  v_districts uuid[];
begin
  if p_z < 11 or p_z > 22 or not public.has_permission('map.view') then
    return ''::bytea;
  end if;
  v_all := private.user_has_all_districts(auth.uid());
  v_districts := private.user_district_ids(auth.uid());
  if p_z >= 13 then
    select st_asmvt(t.*, 'parcels') into v from (
      select st_asmvtgeom(st_transform(p.geom, 3857), v_env) as geom, p.id::text as id, p.pun, p.status::text as status,
             p.land_use::text as land_use, p.area_m2::float8 as area_m2, p.application_id::text as application_id,
             p.geom_provisional as provisional
      from public.parcels p
      where p.deleted_at is null and p.status <> 'archived' and (not p.geom_provisional or p.status = 'registered')
        and p.geom && st_transform(v_env, 4326)
        and (v_all or p.district_id = any (v_districts))) t;
  end if;
  select st_asmvt(t.*, 'parcel_pins') into v_pins from (
    select st_asmvtgeom(st_transform(st_pointonsurface(p.geom), 3857), v_env) as geom, p.id::text as id, p.pun, p.house_no
    from public.parcels p
    where p.deleted_at is null and p.status = 'registered' and p.geom is not null
      and p.geom && st_transform(v_env, 4326)
      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea) || coalesce(v_pins, ''::bytea);
end;
$$;
