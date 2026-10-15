-- ============================================================================
-- 0001 Foundation: extensions, schemas, enums, shared helpers
-- ============================================================================

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- pg_cron is only available on hosted Supabase / the local stack; don't fail elsewhere.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- `private` holds helpers that RLS policies and RPCs use but PostgREST never exposes.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_status as enum ('active', 'invited', 'suspended', 'deleted');
create type public.user_kind as enum ('staff', 'citizen');
create type public.data_scope as enum ('own', 'district', 'districts', 'all');
create type public.job_status as enum ('queued', 'running', 'done', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request context. The Next.js server forwards the browser IP and a request id as
-- headers on every PostgREST call; audit rows and login events record them.
-- ---------------------------------------------------------------------------
create or replace function private.request_header(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.headers', true), '')::json ->> p_name;
$$;

create or replace function private.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    private.request_header('x-client-ip'),
    split_part(private.request_header('x-forwarded-for'), ',', 1)
  );
$$;

create or replace function private.request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select private.request_header('x-request-id');
$$;

-- Raise one of the shared error codes (packages/core/src/errors.ts). The server maps the
-- message prefix back to the code and the UI shows a translated message.
create or replace function private.raise_app_error(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = case when p_detail is null then p_code else p_code || ': ' || p_detail end;
end;
$$;
