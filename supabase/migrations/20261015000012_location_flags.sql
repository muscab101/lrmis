-- ============================================================================
-- 0012 `has_geom` flags so lists can show mapping progress without fetching shapes.
-- ============================================================================
alter table public.regions        add column has_geom boolean generated always as (geom is not null) stored;
alter table public.districts      add column has_geom boolean generated always as (geom is not null) stored;
alter table public.sections       add column has_geom boolean generated always as (geom is not null) stored;
alter table public.sectors        add column has_geom boolean generated always as (geom is not null) stored;
alter table public.neighbourhoods add column has_geom boolean generated always as (geom is not null) stored;
alter table public.streets        add column has_geom boolean generated always as (geom is not null) stored;
alter table public.facilities     add column has_geom boolean generated always as (geom is not null) stored;
