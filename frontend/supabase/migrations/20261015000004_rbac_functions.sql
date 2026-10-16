-- ============================================================================
-- 0004 Authorisation functions, auth hook, new-user trigger, session state
-- All are SECURITY DEFINER with an empty search_path so RLS policies can call them
-- without recursion and without trusting the caller's search_path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------------
create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = p_key), p_default);
$$;

create or replace function private.setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Session checks
-- ---------------------------------------------------------------------------
create or replace function private.jwt_iat()
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'iat')::bigint, 0);
$$;

create or replace function private.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

/**
 * True when the caller is an active, not-deleted user whose token was issued after any
 * forced sign-out, and — for staff, when 2FA is required — the session is aal2.
 */
create or replace function private.caller_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.status = 'active'
      and p.deleted_at is null
      and (p.sessions_revoked_at is null
           or private.jwt_iat() > extract(epoch from p.sessions_revoked_at)::bigint)
      and (p.kind = 'citizen'
           or not private.setting_bool('security.staff_mfa_required', true)
           or private.is_aal2())
  );
$$;

create or replace function private.caller_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and kind = 'staff');
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create or replace function private.user_grants_all(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user_id and r.grants_all
  );
$$;

create or replace function private.user_permissions(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.user_grants_all(p_user_id) then (select array_agg(key order by key) from public.permissions)
    else coalesce((
      select array_agg(distinct rp.permission_key order by rp.permission_key)
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = p_user_id
    ), '{}')
  end;
$$;

/** Main check used by RLS and RPCs: has_permission('parcels.approve'). */
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.caller_is_active() and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = p_key
    where ur.user_id = auth.uid()
      and (r.grants_all or rp.permission_key is not null)
  );
$$;

create or replace function public.has_permission(p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_module || '.' || p_action);
$$;

/** Effective permissions of the caller (for the UI: sidebar, buttons). Empty if inactive. */
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.caller_is_active() then private.user_permissions(auth.uid()) else '{}'::text[] end;
$$;

-- ---------------------------------------------------------------------------
-- Data scope and districts
-- ---------------------------------------------------------------------------
create or replace function private.scope_rank(p_scope public.data_scope)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_scope when 'own' then 0 when 'district' then 1 when 'districts' then 2 when 'all' then 3 end;
$$;

create or replace function private.user_scope(p_user_id uuid)
returns public.data_scope
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.data_scope from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = p_user_id
     order by private.scope_rank(r.data_scope) desc limit 1),
    'own'::public.data_scope);
$$;

create or replace function private.user_has_all_districts(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_scope(p_user_id) = 'all'
      or (private.user_scope(p_user_id) in ('district', 'districts')
          and coalesce((select all_districts from public.profiles where user_id = p_user_id), false));
$$;

create or replace function private.user_district_ids(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.user_has_all_districts(p_user_id)
      then coalesce((select array_agg(id) from public.districts where deleted_at is null), '{}')
    when private.user_scope(p_user_id) in ('district', 'districts')
      then coalesce((select array_agg(district_id) from public.user_districts where user_id = p_user_id), '{}')
    else '{}'::uuid[]
  end;
$$;

/** Districts the caller may see. Used by district-scoped RLS policies in later phases. */
create or replace function public.user_district_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.caller_is_active() then private.user_district_ids(auth.uid()) else '{}'::uuid[] end;
$$;

create or replace function public.can_access_district(p_district_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.caller_is_active()
     and (private.user_has_all_districts(auth.uid())
          or p_district_id = any (private.user_district_ids(auth.uid())));
$$;

/** Maker-checker: the creator of a record can never approve it (any role, admins included). */
create or replace function private.assert_maker_checker(p_created_by uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_created_by is not null and p_created_by = auth.uid() then
    perform private.raise_app_error('MAKER_CHECKER');
  end if;
end;
$$;

/** Raise a precise error instead of a generic denial (MFA vs permission vs suspended). */
create or replace function private.assert_permission(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select * into v_profile from public.profiles where user_id = auth.uid();
  if v_profile is null or v_profile.status <> 'active' or v_profile.deleted_at is not null then
    perform private.raise_app_error('ACCOUNT_SUSPENDED');
  end if;
  if v_profile.kind = 'staff'
     and private.setting_bool('security.staff_mfa_required', true)
     and not private.is_aal2() then
    perform private.raise_app_error('MFA_REQUIRED');
  end if;
  if not public.has_permission(p_key) then
    perform private.raise_app_error('PERMISSION_DENIED', p_key);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Custom access token hook: role ids + district ids + kind in the JWT.
-- Permissions themselves are always read from the database (never trusted from the JWT).
-- Enable in supabase/config.toml → [auth.hook.custom_access_token].
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id = v_user_id;

  v_claims := v_claims
    || jsonb_build_object(
         'user_kind', coalesce(v_profile.kind::text, 'citizen'),
         'user_status', coalesce(v_profile.status::text, 'active'),
         'role_ids', coalesce((select jsonb_agg(role_id) from public.user_roles where user_id = v_user_id), '[]'::jsonb),
         'district_ids', to_jsonb(private.user_district_ids(v_user_id)),
         'all_districts', private.user_has_all_districts(v_user_id)
       );

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- New auth user → profile. `kind` comes from app_metadata, which only the service role
-- can set; anything signing up by itself (phone OTP, Google) is a citizen.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.user_kind :=
    case when new.raw_app_meta_data ->> 'kind' = 'staff' then 'staff' else 'citizen' end;
begin
  insert into public.profiles (user_id, kind, full_name, email, phone, status)
  values (
    new.id,
    v_kind,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    lower(new.email),
    nullif(new.phone, ''),
    case when v_kind = 'staff' then 'invited'::public.user_status else 'active'::public.user_status end
  );

  if v_kind = 'citizen' then
    insert into public.user_roles (user_id, role_id)
    select new.id, id from public.roles where key = 'citizen';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    update public.profiles
       set email = lower(new.email), phone = coalesce(nullif(new.phone, ''), phone)
     where user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, phone on auth.users
  for each row execute function private.handle_auth_user_updated();

-- ---------------------------------------------------------------------------
-- Session state for the middleware gate (one round trip per navigation).
-- ---------------------------------------------------------------------------
create or replace function public.my_session_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', p.kind,
    'status', p.status,
    'deleted', p.deleted_at is not null,
    'must_change_password', p.must_change_password,
    'mfa_required', p.kind = 'staff' and private.setting_bool('security.staff_mfa_required', true),
    'permissions_changed_at', extract(epoch from p.permissions_changed_at)::bigint,
    'sessions_revoked_at', extract(epoch from p.sessions_revoked_at)::bigint,
    'locale', p.locale
  )
  from public.profiles p
  where p.user_id = auth.uid();
$$;
