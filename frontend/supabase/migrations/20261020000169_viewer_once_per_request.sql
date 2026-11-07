-- Speed: work out who the signed-in person is once per request, not once per row.
--
-- Every row a list shows was checked with "is this account active? what are its permissions? which districts?",
-- each answer read again from profiles, user_roles, roles, role_permissions and settings — about 3 ms a row,
-- even for a super admin. Now the answers are worked out the first time they are needed in a request and kept
-- for the rest of that request (a transaction setting, gone when the request ends), so each row only compares.
-- Who can see what does not change.

/** The signed-in person's answers for this request: worked out on first use, then reused. */
create or replace function private.viewer_load()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_uid uuid := auth.uid();
  v_active boolean;
  v_all boolean;
  v_scope public.data_scope;
  v_perms text[];
  v_districts uuid[];
begin
  -- Already worked out for this same sign-in in this request.
  if current_setting('dhulka.viewer_key', true) = v_claims and v_claims <> '' then
    return;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.user_id = v_uid and p.status = 'active' and p.deleted_at is null
       and (p.sessions_revoked_at is null or private.jwt_iat() > extract(epoch from p.sessions_revoked_at)::bigint)
       and (p.kind = 'citizen' or not private.setting_bool('security.staff_mfa_required', true) or private.is_aal2())
  ) into v_active;

  v_scope := private.user_scope(v_uid);
  v_all := v_scope = 'all'
        or (v_scope in ('district', 'districts')
            and coalesce((select all_districts from public.profiles where user_id = v_uid), false));
  v_districts := case
    when v_all then coalesce((select array_agg(id) from public.districts where deleted_at is null), '{}')
    when v_scope in ('district', 'districts')
      then coalesce((select array_agg(district_id) from public.user_districts where user_id = v_uid), '{}')
    else '{}'::uuid[]
  end;
  v_perms := case
    when private.user_grants_all(v_uid) then array['*']
    else coalesce((select array_agg(distinct rp.permission_key) from public.user_roles ur
                    join public.role_permissions rp on rp.role_id = ur.role_id where ur.user_id = v_uid), '{}')
  end;

  perform set_config('dhulka.viewer_active', v_active::text, true);
  perform set_config('dhulka.viewer_all', v_all::text, true);
  perform set_config('dhulka.viewer_districts', v_districts::text, true);
  -- Wrapped in commas so a lookup is one text search: ",parcels.view,".
  perform set_config('dhulka.viewer_perms', ',' || array_to_string(v_perms, ',') || ',', true);
  perform set_config('dhulka.viewer_key', v_claims, true);
end;
$$;
revoke all on function private.viewer_load() from public;

create or replace function private.caller_is_active()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return false; end if;
  perform private.viewer_load();
  return current_setting('dhulka.viewer_active', true) = 'true';
end;
$$;

create or replace function public.has_permission(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_perms text;
begin
  if auth.uid() is null then return false; end if;
  perform private.viewer_load();
  if current_setting('dhulka.viewer_active', true) <> 'true' then return false; end if;
  v_perms := current_setting('dhulka.viewer_perms', true);
  return v_perms = ',*,' or strpos(v_perms, ',' || p_key || ',') > 0;
end;
$$;

create or replace function public.can_access_district(p_district_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return false; end if;
  perform private.viewer_load();
  if current_setting('dhulka.viewer_active', true) <> 'true' then return false; end if;
  return current_setting('dhulka.viewer_all', true) = 'true'
      or p_district_id = any (current_setting('dhulka.viewer_districts', true)::uuid[]);
end;
$$;

-- Asked about the signed-in person: the answer kept for this request. About someone else: worked out as before.
create or replace function private.user_has_all_districts(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null and p_user_id = auth.uid() then
    perform private.viewer_load();
    return current_setting('dhulka.viewer_all', true) = 'true';
  end if;
  return private.user_scope(p_user_id) = 'all'
      or (private.user_scope(p_user_id) in ('district', 'districts')
          and coalesce((select all_districts from public.profiles where user_id = p_user_id), false));
end;
$$;

create or replace function private.user_district_ids(p_user_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null and p_user_id = auth.uid() then
    perform private.viewer_load();
    return current_setting('dhulka.viewer_districts', true)::uuid[];
  end if;
  return case
    when private.user_has_all_districts(p_user_id)
      then coalesce((select array_agg(id) from public.districts where deleted_at is null), '{}')
    when private.user_scope(p_user_id) in ('district', 'districts')
      then coalesce((select array_agg(district_id) from public.user_districts where user_id = p_user_id), '{}')
    else '{}'::uuid[]
  end;
end;
$$;
