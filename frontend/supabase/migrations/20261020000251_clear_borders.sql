-- The imported district and section borders were wrong: keep a copy, then clear them so staff draw their own on the map.
create table if not exists private.location_geom_backup (
  level text not null,
  id uuid not null,
  geom extensions.geometry not null,
  saved_at timestamptz not null default now(),
  primary key (level, id, saved_at)
);
insert into private.location_geom_backup (level, id, geom)
select 'districts', id, geom from public.districts where geom is not null
union all
select 'sections', id, geom from public.sections where geom is not null;
update public.districts set geom = null where geom is not null;
update public.sections set geom = null where geom is not null;
