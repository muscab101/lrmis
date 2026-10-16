-- ============================================================================
-- 0011 Phase 2 — Locations: sections, sectors, neighbourhoods, streets, facilities,
-- geometry import, lookups and vector tiles (ST_AsMVT).
-- Spatial functions use `search_path = extensions` so PostGIS operators (&&, …) resolve;
-- every table is still schema-qualified.
-- ============================================================================

create type public.facility_kind as enum (
  'school', 'mosque', 'hospital', 'clinic', 'market', 'police', 'government', 'water', 'park', 'other'
);

create table public.sections (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.districts (id),
  code         text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name_so      text not null,
  name_en      text not null,
  geom         extensions.geometry(MultiPolygon, 4326),
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz,
  unique (district_id, code)
);

create table public.sectors (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.sections (id),
  district_id  uuid not null references public.districts (id), -- kept in sync by trigger
  code         text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name_so      text not null,
  name_en      text not null,
  geom         extensions.geometry(MultiPolygon, 4326),
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz,
  unique (section_id, code)
);

create table public.neighbourhoods (
  id           uuid primary key default gen_random_uuid(),
  sector_id    uuid not null references public.sectors (id),
  district_id  uuid not null references public.districts (id), -- kept in sync by trigger
  -- Used in the PUN (BN-<district>-<neighbourhood>-<serial>): unique per district.
  code         text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name_so      text not null,
  name_en      text not null,
  capacity     int check (capacity is null or capacity >= 0),
  geom         extensions.geometry(MultiPolygon, 4326),
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz,
  unique (district_id, code)
);

create table public.streets (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.districts (id),
  name_so      text not null,
  name_en      text not null default '',
  geom         extensions.geometry(MultiLineString, 4326),
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz
);

create table public.facilities (
  id           uuid primary key default gen_random_uuid(),
  district_id  uuid not null references public.districts (id),
  kind         public.facility_kind not null default 'other',
  name_so      text not null,
  name_en      text not null default '',
  geom         extensions.geometry(Point, 4326),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz
);

-- Indexes: FKs, GIST on geometry, trigram on names
create index sections_district_idx on public.sections (district_id);
create index sectors_section_idx on public.sectors (section_id);
create index sectors_district_idx on public.sectors (district_id);
create index neighbourhoods_sector_idx on public.neighbourhoods (sector_id);
create index neighbourhoods_district_idx on public.neighbourhoods (district_id);
create index streets_district_idx on public.streets (district_id);
create index facilities_district_idx on public.facilities (district_id);
create index sections_created_by_idx on public.sections (created_by);
create index sectors_created_by_idx on public.sectors (created_by);
create index neighbourhoods_created_by_idx on public.neighbourhoods (created_by);
create index streets_created_by_idx on public.streets (created_by);
create index facilities_created_by_idx on public.facilities (created_by);
create index regions_geom_gist on public.regions using gist (geom);
create index districts_geom_gist on public.districts using gist (geom);
create index sections_geom_gist on public.sections using gist (geom);
create index sectors_geom_gist on public.sectors using gist (geom);
create index neighbourhoods_geom_gist on public.neighbourhoods using gist (geom);
create index streets_geom_gist on public.streets using gist (geom);
create index facilities_geom_gist on public.facilities using gist (geom);
create index neighbourhoods_name_trgm on public.neighbourhoods using gin (name_so extensions.gin_trgm_ops);
create index neighbourhoods_name_en_trgm on public.neighbourhoods using gin (name_en extensions.gin_trgm_ops);
create index streets_name_trgm on public.streets using gin (name_so extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Hierarchy: district_id always follows the parent (no mismatched rows possible).
-- ---------------------------------------------------------------------------
create or replace function private.sync_sector_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select district_id into new.district_id from public.sections where id = new.section_id;
  if new.district_id is null then
    perform private.raise_app_error('NOT_FOUND', 'section');
  end if;
  return new;
end;
$$;

create or replace function private.sync_neighbourhood_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select district_id into new.district_id from public.sectors where id = new.sector_id;
  if new.district_id is null then
    perform private.raise_app_error('NOT_FOUND', 'sector');
  end if;
  return new;
end;
$$;

-- When a section moves district, its sectors and neighbourhoods follow.
create or replace function private.cascade_section_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.district_id is distinct from old.district_id then
    update public.sectors set district_id = new.district_id where section_id = new.id;
    update public.neighbourhoods n set district_id = new.district_id
      from public.sectors s where s.id = n.sector_id and s.section_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function private.cascade_sector_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.district_id is distinct from old.district_id then
    update public.neighbourhoods set district_id = new.district_id where sector_id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_district before insert or update of section_id on public.sectors
  for each row execute function private.sync_sector_district();
create trigger sync_district before insert or update of sector_id on public.neighbourhoods
  for each row execute function private.sync_neighbourhood_district();
create trigger cascade_district after update of district_id on public.sections
  for each row execute function private.cascade_section_district();
create trigger cascade_district after update of district_id on public.sectors
  for each row execute function private.cascade_sector_district();

-- updated_at + audit
create trigger set_updated_at before update on public.sections for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.sectors for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.neighbourhoods for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.streets for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.facilities for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.sections for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.sectors for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.neighbourhoods for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.streets for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.facilities for each row execute function private.audit_row();

-- Geometry is huge in the audit log: record only that it changed.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_pk     text  := coalesce(tg_argv[0], 'id');
  v_geom_changed boolean := (v_before ? 'geom' or v_after ? 'geom')
                            and (v_before -> 'geom') is distinct from (v_after -> 'geom');
begin
  if v_before is not null then v_before := v_before - 'geom'; end if;
  if v_after is not null then v_after := v_after - 'geom'; end if;
  if v_geom_changed then
    v_after := coalesce(v_after, '{}'::jsonb) || jsonb_build_object('geom_changed', true);
  end if;

  if tg_op = 'UPDATE'
     and (v_before - array['updated_at', 'last_login_at']) = (v_after - array['updated_at', 'last_login_at']) then
    return new;
  end if;
  perform private.audit(
    lower(tg_op), tg_table_name,
    coalesce(v_after ->> v_pk, v_before ->> v_pk),
    v_before, v_after
  );
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Boundaries are readable by every signed-in user (needed for pickers and the
-- map); writes need locations.* and — for district-level staff — that district.
-- Nothing is hard-deleted: "archive" sets deleted_at (locations.delete).
-- ---------------------------------------------------------------------------
alter table public.sections enable row level security;
alter table public.sectors enable row level security;
alter table public.neighbourhoods enable row level security;
alter table public.streets enable row level security;
alter table public.facilities enable row level security;

revoke all on public.sections, public.sectors, public.neighbourhoods, public.streets, public.facilities from anon;
revoke delete on public.sections, public.sectors, public.neighbourhoods, public.streets, public.facilities from authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['sections', 'sectors', 'neighbourhoods', 'streets', 'facilities'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (deleted_at is null or (select public.has_permission('locations.view')));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check ((select public.has_permission('locations.create')) and public.can_access_district(district_id));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (((select public.has_permission('locations.update')) or (select public.has_permission('locations.delete')))
               and public.can_access_district(district_id))
        with check (((select public.has_permission('locations.update')) or (select public.has_permission('locations.delete')))
                    and public.can_access_district(district_id));
    $f$, t);
  end loop;
end $$;

-- sectors/neighbourhoods get district_id from the trigger, which runs before the RLS
-- WITH CHECK, so the district check above uses the real district.

-- ---------------------------------------------------------------------------
-- Geometry import (GeoJSON from the locations page). Invalid shapes are repaired with
-- ST_MakeValid; anything that isn't a polygon/line/point of the right kind is rejected.
-- ---------------------------------------------------------------------------
create or replace function private.geojson_to_geometry(p_geojson jsonb, p_kind text)
returns extensions.geometry
language plpgsql
immutable
set search_path = extensions
as $$
declare
  v_g geometry;
  v_type int := case p_kind when 'polygon' then 3 when 'line' then 2 else 1 end;
begin
  begin
    -- Accept a bare geometry, a Feature or a FeatureCollection.
    if p_geojson ->> 'type' = 'FeatureCollection' then
      select st_union(st_setsrid(st_geomfromgeojson(f -> 'geometry'), 4326)) into v_g
      from jsonb_array_elements(p_geojson -> 'features') f;
    elsif p_geojson ->> 'type' = 'Feature' then
      v_g := st_setsrid(st_geomfromgeojson(p_geojson -> 'geometry'), 4326);
    else
      v_g := st_setsrid(st_geomfromgeojson(p_geojson), 4326);
    end if;
  exception when others then
    perform private.raise_app_error('VALIDATION', 'geojson');
  end;

  if v_g is null or st_isempty(v_g) then
    perform private.raise_app_error('VALIDATION', 'empty geometry');
  end if;
  -- Coordinates must be lon/lat (WGS84), roughly within Somalia's bounding box.
  if not st_within(v_g, st_makeenvelope(40, -2, 52, 12.5, 4326)) then
    perform private.raise_app_error('VALIDATION', 'outside Somalia');
  end if;

  v_g := st_collectionextract(st_makevalid(v_g), v_type);
  if st_isempty(v_g) then
    perform private.raise_app_error('VALIDATION', 'wrong geometry type');
  end if;
  if p_kind = 'point' then
    return st_geometryn(v_g, 1);
  end if;
  return st_multi(v_g);
end;
$$;

create or replace function public.locations_set_geometry(p_level text, p_id uuid, p_geojson jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = extensions
as $$
declare
  v_kind text := case p_level when 'streets' then 'line' when 'facilities' then 'point' else 'polygon' end;
  v_geom geometry;
  v_count int;
begin
  if p_level not in ('regions', 'districts', 'sections', 'sectors', 'neighbourhoods', 'streets', 'facilities') then
    perform private.raise_app_error('VALIDATION', 'level');
  end if;
  perform private.assert_permission('locations.update');
  v_geom := private.geojson_to_geometry(p_geojson, v_kind);

  -- Runs as the caller: RLS decides whether this row (district) may be changed.
  execute format('update public.%I set geom = $1 where id = $2 and deleted_at is null', p_level)
    using v_geom, p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform private.raise_app_error('NOT_FOUND', p_level);
  end if;

  return jsonb_build_object(
    'area_m2', case when v_kind = 'polygon' then round(st_area(v_geom::geography)::numeric, 1) end,
    'length_m', case when v_kind = 'line' then round(st_length(v_geom::geography)::numeric, 1) end,
    'bbox', st_asgeojson(st_envelope(v_geom))::jsonb
  );
end;
$$;

/** GeoJSON (simplified for display) of one location, for previews and "zoom to". */
create or replace function public.location_geojson(p_level text, p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = extensions
as $$
declare
  v jsonb;
begin
  if p_level not in ('regions', 'districts', 'sections', 'sectors', 'neighbourhoods', 'streets', 'facilities') then
    perform private.raise_app_error('VALIDATION', 'level');
  end if;
  execute format(
    'select jsonb_build_object(''geometry'', st_asgeojson(st_simplifypreservetopology(geom, 0.00001), 6)::jsonb,
                               ''bbox'', array[st_xmin(geom), st_ymin(geom), st_xmax(geom), st_ymax(geom)])
       from public.%I where id = $1 and geom is not null', p_level)
    into v using p_id;
  return v;
end;
$$;

/** Which neighbourhood/district contains a point (map pin, phone GPS). */
create or replace function public.locate_point(p_lon double precision, p_lat double precision)
returns table (neighbourhood_id uuid, neighbourhood_code text, neighbourhood_name_so text, neighbourhood_name_en text,
               district_id uuid, district_code text, district_name_so text, district_name_en text)
language sql
stable
security invoker
set search_path = extensions
as $$
  select n.id, n.code, n.name_so, n.name_en, d.id, d.code, d.name_so, d.name_en
  from public.neighbourhoods n
  join public.districts d on d.id = n.district_id
  where n.deleted_at is null and n.geom is not null
    and st_intersects(n.geom, st_setsrid(st_makepoint(p_lon, p_lat), 4326))
  limit 1;
$$;

/** Async picker search (never ship thousands of options to the browser). */
create or replace function public.search_neighbourhoods(p_q text, p_district_id uuid default null, p_limit int default 20)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_code text,
               district_name_so text, sector_name_so text, has_geom boolean)
language sql
stable
security invoker
set search_path = extensions
as $$
  select n.id, n.code, n.name_so, n.name_en, d.id, d.code, d.name_so, s.name_so, n.geom is not null
  from public.neighbourhoods n
  join public.districts d on d.id = n.district_id
  join public.sectors s on s.id = n.sector_id
  where n.deleted_at is null
    and (p_district_id is null or n.district_id = p_district_id)
    and (coalesce(trim(p_q), '') = ''
         or n.name_so ilike '%' || trim(p_q) || '%' or n.name_en ilike '%' || trim(p_q) || '%'
         or n.code ilike trim(p_q) || '%' or similarity(n.name_so, trim(p_q)) > 0.3)
  order by (coalesce(trim(p_q), '') <> '' and n.code ilike trim(p_q) || '%') desc,
           similarity(n.name_so, coalesce(p_q, '')) desc, d.name_so, n.name_so
  limit least(greatest(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Vector tiles. Only names/codes leave the database (no personal data), so boundaries
-- can be shown on the public map too. Layers appear from sensible zoom levels.
-- ---------------------------------------------------------------------------
create or replace function public.location_tile(p_layer text, p_z int, p_x int, p_y int)
returns bytea
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v_env4326 geometry := st_transform(v_env, 4326);
  v_tol double precision := case when p_z < 12 then 0.0005 when p_z < 15 then 0.00005 else 0 end;
  v bytea;
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

/** Extent of everything that has a boundary (initial map view). */
create or replace function public.locations_extent()
returns double precision[]
language sql
stable
security definer
set search_path = extensions
as $$
  select case when e is null then null else array[st_xmin(e), st_ymin(e), st_xmax(e), st_ymax(e)] end
  from (select st_extent(geom)::geometry as e from (
          select geom from public.districts where deleted_at is null and geom is not null
          union all select geom from public.neighbourhoods where deleted_at is null and geom is not null) g) x;
$$;

/** Counts per district for the locations overview. */
create or replace function public.location_counts()
returns table (district_id uuid, sections bigint, sectors bigint, neighbourhoods bigint, mapped_neighbourhoods bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id,
    (select count(*) from public.sections s where s.district_id = d.id and s.deleted_at is null),
    (select count(*) from public.sectors s where s.district_id = d.id and s.deleted_at is null),
    (select count(*) from public.neighbourhoods n where n.district_id = d.id and n.deleted_at is null),
    (select count(*) from public.neighbourhoods n where n.district_id = d.id and n.deleted_at is null and n.geom is not null)
  from public.districts d where d.deleted_at is null;
$$;

revoke execute on function
  private.geojson_to_geometry(jsonb, text),
  public.locations_set_geometry(text, uuid, jsonb),
  public.location_geojson(text, uuid),
  public.locate_point(double precision, double precision),
  public.search_neighbourhoods(text, uuid, int),
  public.location_tile(text, int, int, int),
  public.locations_extent(),
  public.location_counts()
from public, anon, authenticated;

grant execute on function
  public.locations_set_geometry(text, uuid, jsonb),
  public.location_geojson(text, uuid),
  public.locate_point(double precision, double precision),
  public.search_neighbourhoods(text, uuid, int),
  public.location_counts()
to authenticated;

-- locations_set_geometry runs as the caller (RLS decides the district), so the caller
-- needs these small helpers; none of them reads data on its own.
grant execute on function
  private.geojson_to_geometry(jsonb, text),
  private.assert_permission(text),
  private.raise_app_error(text, text)
to authenticated;

-- Tiles and extent carry only public boundary data: available to the public map too.
grant execute on function public.location_tile(text, int, int, int), public.locations_extent() to anon, authenticated;
