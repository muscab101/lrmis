-- ============================================================================
-- 0007 Admin RPCs (users + roles), safety guards, login lockout, setup, self-service,
-- idempotency. Auth operations (create auth user, ban, password, MFA factors) happen in
-- Next.js server actions with the service-role key; everything else lives here so it is
-- transactional and enforced by the database for every caller.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Guard: there must always be at least one active Super Admin.
-- Deferred so moving the role between users inside one transaction is allowed.
-- ---------------------------------------------------------------------------
create or replace function private.active_super_admin_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct ur.user_id)::int
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.user_id = ur.user_id
  where r.grants_all and p.status = 'active' and p.deleted_at is null;
$$;

create or replace function private.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touched_super boolean;
begin
  if tg_table_name = 'user_roles' then
    v_touched_super := exists (select 1 from public.roles where id = old.role_id and grants_all);
  else
    v_touched_super := private.user_grants_all(old.user_id)
      and old.status = 'active' and old.deleted_at is null;
  end if;

  if v_touched_super and private.active_super_admin_count() = 0 then
    perform private.raise_app_error('LAST_SUPER_ADMIN');
  end if;
  return null;
end;
$$;

create constraint trigger guard_last_super_admin
  after update or delete on public.user_roles
  deferrable initially deferred
  for each row execute function private.guard_last_super_admin();

create constraint trigger guard_last_super_admin
  after update of status, deleted_at on public.profiles
  deferrable initially deferred
  for each row execute function private.guard_last_super_admin();

-- Super Admin role row itself can never change or disappear.
create or replace function private.guard_protected_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_protected then
    if tg_op = 'DELETE' then
      perform private.raise_app_error('PROTECTED_ROLE');
    end if;
    if (to_jsonb(new) - array['updated_at', 'name_so', 'name_en', 'description', 'colour'])
       is distinct from (to_jsonb(old) - array['updated_at', 'name_so', 'name_en', 'description', 'colour']) then
      perform private.raise_app_error('PROTECTED_ROLE');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_protected_role before update or delete on public.roles
  for each row execute function private.guard_protected_role();

-- ---------------------------------------------------------------------------
-- Escalation guards
-- ---------------------------------------------------------------------------
create or replace function private.assert_can_grant_permissions(p_perms text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  if private.user_grants_all(auth.uid()) then
    return;
  end if;
  select array_agg(x) into v_missing
  from (select unnest(p_perms) except select unnest(private.user_permissions(auth.uid()))) t(x);
  if v_missing is not null then
    perform private.raise_app_error('PRIVILEGE_ESCALATION', array_to_string(v_missing, ','));
  end if;
end;
$$;

create or replace function private.assert_can_grant_scope(p_scope public.data_scope)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.scope_rank(p_scope) > private.scope_rank(private.user_scope(auth.uid())) then
    perform private.raise_app_error('PRIVILEGE_ESCALATION', 'data_scope');
  end if;
end;
$$;

create or replace function private.assert_can_grant_roles(p_role_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_found int := 0;
begin
  for v_role in select * from public.roles where id = any (p_role_ids) loop
    v_found := v_found + 1;
    if v_role.grants_all and not private.user_grants_all(auth.uid()) then
      perform private.raise_app_error('PRIVILEGE_ESCALATION', v_role.key);
    end if;
    perform private.assert_can_grant_permissions(
      coalesce((select array_agg(permission_key) from public.role_permissions where role_id = v_role.id), '{}'));
    perform private.assert_can_grant_scope(v_role.data_scope);
  end loop;
  if v_found <> (select count(distinct x) from unnest(p_role_ids) x) then
    perform private.raise_app_error('NOT_FOUND', 'role');
  end if;
end;
$$;

create or replace function private.assert_can_assign_districts(p_all boolean, p_district_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(p_district_ids) d
             where not exists (select 1 from public.districts where id = d and deleted_at is null)) then
    perform private.raise_app_error('NOT_FOUND', 'district');
  end if;
  if private.user_has_all_districts(auth.uid()) then
    return;
  end if;
  if p_all or exists (select unnest(p_district_ids) except select unnest(private.user_district_ids(auth.uid()))) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
end;
$$;

/** The actor may manage the target: target is staff, and only a Super Admin manages Super Admins. */
create or replace function private.assert_can_manage_user(p_target uuid, p_allow_self boolean default false)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where user_id = p_target;
  if v_target is null then
    perform private.raise_app_error('NOT_FOUND', 'user');
  end if;
  if not p_allow_self and p_target = auth.uid() then
    perform private.raise_app_error('SELF_ACTION_FORBIDDEN');
  end if;
  if private.user_grants_all(p_target) and not private.user_grants_all(auth.uid()) then
    perform private.raise_app_error('PERMISSION_DENIED', 'super_admin');
  end if;
  if not private.user_has_all_districts(auth.uid()) and (
       private.user_has_all_districts(p_target)
       or exists (select district_id from public.user_districts where user_id = p_target
                  except select unnest(private.user_district_ids(auth.uid()))))
  then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  return v_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal setters
-- ---------------------------------------------------------------------------
/** Revoke refresh tokens. Access tokens are already rejected via sessions_revoked_at. */
create or replace function private.delete_auth_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
exception when others then
  raise notice 'could not delete auth sessions: %', sqlerrm;
end;
$$;
create or replace function private.user_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'status', p.status,
    'all_districts', p.all_districts,
    'role_ids', coalesce((select jsonb_agg(role_id order by role_id) from public.user_roles where user_id = p.user_id), '[]'),
    'district_ids', coalesce((select jsonb_agg(district_id order by district_id) from public.user_districts where user_id = p.user_id), '[]')
  )
  from public.profiles p where p.user_id = p_user_id;
$$;

create or replace function private.set_user_roles(p_user_id uuid, p_role_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_roles where user_id = p_user_id and role_id <> all (p_role_ids);
  insert into public.user_roles (user_id, role_id, assigned_by)
  select p_user_id, r, auth.uid() from unnest(p_role_ids) r
  on conflict do nothing;
end;
$$;

create or replace function private.set_user_districts(p_user_id uuid, p_all boolean, p_district_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set all_districts = p_all where user_id = p_user_id;
  delete from public.user_districts
   where user_id = p_user_id and (p_all or district_id <> all (p_district_ids));
  if not p_all then
    insert into public.user_districts (user_id, district_id, assigned_by)
    select p_user_id, d, auth.uid() from unnest(p_district_ids) d
    on conflict do nothing;
  end if;
end;
$$;

create or replace function private.notify(
  p_user_id uuid, p_kind text, p_title_so text, p_title_en text, p_link text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title_so, title_en, link)
  values (p_user_id, p_kind, p_title_so, p_title_en, p_link);
  -- Email copy is sent by the send-message worker.
  insert into public.jobs (kind, payload, created_by)
  values ('email.account_notice', jsonb_build_object('user_id', p_user_id, 'kind', p_kind), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

/** Preflight before the server creates the auth user (fail fast, nothing written). */
create or replace function public.admin_validate_user_grants(
  p_role_ids uuid[], p_all_districts boolean, p_district_ids uuid[]
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('users.create');
  perform private.assert_can_grant_roles(p_role_ids);
  perform private.assert_can_assign_districts(p_all_districts, coalesce(p_district_ids, '{}'));
end;
$$;

/** Completes a staff account after `auth.admin.createUser` (profile row made by trigger). */
create or replace function public.admin_provision_user(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_role_ids uuid[],
  p_all_districts boolean,
  p_district_ids uuid[],
  p_invited boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_validate_user_grants(p_role_ids, p_all_districts, p_district_ids);

  update public.profiles
     set kind = 'staff',
         full_name = trim(p_full_name),
         phone = nullif(trim(p_phone), ''),
         status = case when p_invited then 'invited'::public.user_status else 'active'::public.user_status end,
         must_change_password = not p_invited,
         created_by = auth.uid(),
         permissions_changed_at = now()
   where user_id = p_user_id;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'user');
  end if;

  -- A staff account never keeps the citizen role the signup trigger may have given it.
  delete from public.user_roles where user_id = p_user_id;
  perform private.set_user_roles(p_user_id, p_role_ids);
  perform private.set_user_districts(p_user_id, p_all_districts, coalesce(p_district_ids, '{}'));

  perform private.audit('user.create', 'profiles', p_user_id::text, null, private.user_snapshot(p_user_id));
  return private.user_snapshot(p_user_id);
end;
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_role_ids uuid[],
  p_all_districts boolean,
  p_district_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_added uuid[];
  v_access_changed boolean;
begin
  perform private.assert_permission('users.update');
  perform private.assert_can_manage_user(p_user_id, true);
  v_before := private.user_snapshot(p_user_id);

  select array_agg(r) into v_added
  from (select unnest(p_role_ids) except select role_id from public.user_roles where user_id = p_user_id) t(r);

  v_access_changed :=
    (select coalesce(array_agg(x order by x), '{}') from unnest(p_role_ids) x)
      is distinct from (select coalesce(array_agg(role_id order by role_id), '{}') from public.user_roles where user_id = p_user_id)
    or p_all_districts is distinct from (v_before ->> 'all_districts')::boolean
    or (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_district_ids, '{}')) x)
      is distinct from (select coalesce(array_agg(district_id order by district_id), '{}') from public.user_districts where user_id = p_user_id);

  -- Nobody can change their own roles or districts (no self-demotion, no self-promotion).
  if p_user_id = auth.uid() and v_access_changed then
    perform private.raise_app_error('SELF_ACTION_FORBIDDEN');
  end if;

  if v_added is not null then
    perform private.assert_can_grant_roles(v_added);
  end if;
  perform private.assert_can_assign_districts(p_all_districts, coalesce(p_district_ids, '{}'));

  update public.profiles
     set full_name = trim(p_full_name),
         phone = nullif(trim(p_phone), ''),
         permissions_changed_at = case when v_access_changed then now() else permissions_changed_at end
   where user_id = p_user_id;

  perform private.set_user_roles(p_user_id, p_role_ids);
  perform private.set_user_districts(p_user_id, p_all_districts, coalesce(p_district_ids, '{}'));

  perform private.audit('user.update', 'profiles', p_user_id::text, v_before, private.user_snapshot(p_user_id));
  if v_access_changed then
    perform private.notify(p_user_id, 'account.access_changed',
      'Doorarkaaga ama degmooyinkaaga waa la beddelay', 'Your roles or districts were changed');
  end if;
  return private.user_snapshot(p_user_id);
end;
$$;

/** Authorise an auth-side action before the server calls the Admin API. Writes nothing. */
create or replace function public.admin_authorize_user_action(p_user_id uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_action
    when 'suspend', 'reactivate' then
      perform private.assert_permission('users.manage');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'soft_delete' then
      perform private.assert_permission('users.delete');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'hard_delete' then
      perform private.assert_permission('users.delete');
      perform private.assert_can_manage_user(p_user_id, false);
      if not private.user_grants_all(auth.uid()) then
        perform private.raise_app_error('PERMISSION_DENIED', 'hard_delete');
      end if;
      if (public.admin_user_record_counts(p_user_id) ->> 'total')::int > 0 then
        perform private.raise_app_error('HAS_RECORDS');
      end if;
    when 'set_password', 'send_reset_link' then
      perform private.assert_permission('users.reset_password');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'reset_2fa' then
      perform private.assert_permission('users.reset_2fa');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'force_signout' then
      perform private.assert_permission('users.force_signout');
      perform private.assert_can_manage_user(p_user_id, true);
    when 'resend_invite' then
      perform private.assert_permission('users.create');
      perform private.assert_can_manage_user(p_user_id, false);
    else
      perform private.raise_app_error('VALIDATION', 'unknown action');
  end case;
end;
$$;

/** Database side of an auth-side action, called after the Admin API call succeeded. */
create or replace function public.admin_apply_user_action(p_user_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform public.admin_authorize_user_action(p_user_id, p_action);
  v_before := private.user_snapshot(p_user_id);

  case p_action
    when 'suspend' then
      update public.profiles set status = 'suspended', sessions_revoked_at = now() where user_id = p_user_id;
      perform private.delete_auth_sessions(p_user_id);
    when 'reactivate' then
      update public.profiles set status = 'active'
       where user_id = p_user_id and status = 'suspended' and deleted_at is null;
      if not found then
        perform private.raise_app_error('CONFLICT', 'not suspended');
      end if;
    when 'soft_delete' then
      update public.profiles set status = 'deleted', deleted_at = now(), sessions_revoked_at = now()
       where user_id = p_user_id;
      perform private.delete_auth_sessions(p_user_id);
    when 'hard_delete' then
      null; -- the auth user (and cascaded profile) is removed by the server right after
    when 'set_password' then
      update public.profiles set must_change_password = true, sessions_revoked_at = now() where user_id = p_user_id;
      perform private.delete_auth_sessions(p_user_id);
    when 'send_reset_link', 'resend_invite' then
      null;
    when 'reset_2fa' then
      update public.profiles set sessions_revoked_at = now() where user_id = p_user_id;
      perform private.delete_auth_sessions(p_user_id);
    when 'force_signout' then
      update public.profiles set sessions_revoked_at = now() where user_id = p_user_id;
      perform private.delete_auth_sessions(p_user_id);
  end case;

  perform private.audit('user.' || p_action, 'profiles', p_user_id::text, v_before, private.user_snapshot(p_user_id));
  if p_action not in ('hard_delete', 'soft_delete', 'resend_invite') then
    perform private.notify(p_user_id, 'account.' || p_action,
      'Akoonkaaga waa la beddelay (' || p_action || ')', 'Your account was changed (' || p_action || ')');
  end if;
  return private.user_snapshot(p_user_id);
end;
$$;

-- Legal/financial tables register themselves here in later phases (parcels, invoices,
-- payments …). A user with rows in any of them can be suspended but never hard deleted.
create table private.user_record_tables (
  table_name   text primary key,
  column_name  text not null default 'created_by'
);

create or replace function public.admin_user_record_counts(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.user_record_tables;
  v_count bigint;
  v_total bigint := 0;
  v_out jsonb := '{}'::jsonb;
begin
  if not public.has_permission('users.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'users.view');
  end if;
  for v_row in select * from private.user_record_tables loop
    execute format('select count(*) from public.%I where %I = $1', v_row.table_name, v_row.column_name)
      into v_count using p_user_id;
    v_total := v_total + v_count;
    if v_count > 0 then
      v_out := v_out || jsonb_build_object(v_row.table_name, v_count);
    end if;
  end loop;
  return v_out || jsonb_build_object('total', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create or replace function private.validate_role_permissions(p_perms text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clean text[];
begin
  select coalesce(array_agg(distinct x), '{}') into v_clean from unnest(p_perms) x;
  if exists (select 1 from unnest(v_clean) x where not exists (select 1 from public.permissions where key = x)) then
    perform private.raise_app_error('VALIDATION', 'unknown permission');
  end if;
  return v_clean;
end;
$$;

create or replace function private.role_snapshot(p_role_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(r) - array['created_at', 'updated_at']
      || jsonb_build_object('permissions',
           coalesce((select jsonb_agg(permission_key order by permission_key) from public.role_permissions where role_id = r.id), '[]'))
  from public.roles r where r.id = p_role_id;
$$;

create or replace function public.admin_create_role(
  p_name_so text, p_name_en text, p_description text, p_colour text,
  p_data_scope public.data_scope, p_limits jsonb, p_permissions text[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perms text[];
  v_id uuid;
begin
  perform private.assert_permission('roles.create');
  v_perms := private.validate_role_permissions(p_permissions);
  perform private.assert_can_grant_permissions(v_perms);
  perform private.assert_can_grant_scope(p_data_scope);

  if exists (select 1 from public.roles where lower(name_en) = lower(trim(p_name_en)) or lower(name_so) = lower(trim(p_name_so))) then
    perform private.raise_app_error('CONFLICT', 'role name');
  end if;

  insert into public.roles (name_so, name_en, description, colour, data_scope, limits, created_by)
  values (trim(p_name_so), trim(p_name_en), coalesce(p_description, ''), p_colour, p_data_scope,
          coalesce(p_limits, '{}'::jsonb), auth.uid())
  returning id into v_id;

  insert into public.role_permissions (role_id, permission_key) select v_id, unnest(v_perms);
  perform private.audit('role.create', 'roles', v_id::text, null, private.role_snapshot(v_id));
  return v_id;
end;
$$;

create or replace function public.admin_update_role(
  p_role_id uuid, p_name_so text, p_name_en text, p_description text, p_colour text,
  p_data_scope public.data_scope, p_limits jsonb, p_permissions text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_perms text[];
  v_added text[];
  v_before jsonb;
  v_uid uuid;
begin
  perform private.assert_permission('roles.update');
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    perform private.raise_app_error('NOT_FOUND', 'role');
  end if;
  if v_role.is_protected then
    perform private.raise_app_error('PROTECTED_ROLE');
  end if;
  -- Editing a role you hold yourself would let you widen your own access.
  if exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = p_role_id)
     and not private.user_grants_all(auth.uid()) then
    perform private.raise_app_error('SELF_ACTION_FORBIDDEN');
  end if;

  v_perms := private.validate_role_permissions(p_permissions);
  select array_agg(x) into v_added
  from (select unnest(v_perms) except select permission_key from public.role_permissions where role_id = p_role_id) t(x);
  if v_added is not null then
    perform private.assert_can_grant_permissions(v_added);
  end if;
  if private.scope_rank(p_data_scope) > private.scope_rank(v_role.data_scope) then
    perform private.assert_can_grant_scope(p_data_scope);
  end if;

  if exists (select 1 from public.roles where id <> p_role_id
               and (lower(name_en) = lower(trim(p_name_en)) or lower(name_so) = lower(trim(p_name_so)))) then
    perform private.raise_app_error('CONFLICT', 'role name');
  end if;

  v_before := private.role_snapshot(p_role_id);
  update public.roles
     set name_so = trim(p_name_so), name_en = trim(p_name_en), description = coalesce(p_description, ''),
         colour = p_colour, data_scope = p_data_scope, limits = coalesce(p_limits, '{}'::jsonb)
   where id = p_role_id;

  delete from public.role_permissions where role_id = p_role_id and permission_key <> all (v_perms);
  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, unnest(v_perms) on conflict do nothing;

  if private.role_snapshot(p_role_id) is distinct from v_before then
    update public.profiles set permissions_changed_at = now()
     where user_id in (select user_id from public.user_roles where role_id = p_role_id);
    perform private.audit('role.update', 'roles', p_role_id::text, v_before, private.role_snapshot(p_role_id));
    for v_uid in select user_id from public.user_roles where role_id = p_role_id loop
      perform private.notify(v_uid, 'account.role_changed',
        'Ogolaanshaha doorkaaga waa la beddelay', 'The permissions of your role changed');
    end loop;
  end if;
end;
$$;

create or replace function public.admin_reset_role_to_default(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null or not v_role.is_system then
    perform private.raise_app_error('NOT_FOUND', 'system role');
  end if;
  perform public.admin_update_role(p_role_id, v_role.name_so, v_role.name_en, v_role.description,
    v_role.colour, v_role.data_scope, v_role.limits, v_role.default_permissions);
end;
$$;

create or replace function public.admin_delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_users int;
  v_before jsonb;
begin
  perform private.assert_permission('roles.delete');
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    perform private.raise_app_error('NOT_FOUND', 'role');
  end if;
  if v_role.is_protected then
    perform private.raise_app_error('PROTECTED_ROLE');
  end if;
  if v_role.is_system then
    perform private.raise_app_error('SYSTEM_ROLE');
  end if;
  select count(*) into v_users from public.user_roles where role_id = p_role_id;
  if v_users > 0 then
    perform private.raise_app_error('ROLE_IN_USE', v_users::text);
  end if;
  v_before := private.role_snapshot(p_role_id);
  delete from public.roles where id = p_role_id;
  perform private.audit('role.delete', 'roles', p_role_id::text, v_before, null);
end;
$$;

/** Move every holder of one role to another (then the old role can be deleted). */
create or replace function public.admin_move_role_users(p_from uuid, p_to uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_moved int := 0;
begin
  perform private.assert_permission('users.update');
  if p_from = p_to then
    perform private.raise_app_error('VALIDATION', 'same role');
  end if;
  if exists (select 1 from public.roles where id = p_from and is_protected) then
    perform private.raise_app_error('PROTECTED_ROLE');
  end if;
  perform private.assert_can_grant_roles(array[p_to]);
  if exists (select 1 from public.user_roles where role_id = p_from and user_id = auth.uid()) then
    perform private.raise_app_error('SELF_ACTION_FORBIDDEN');
  end if;

  for v_uid in select user_id from public.user_roles where role_id = p_from loop
    perform private.assert_can_manage_user(v_uid, false);
    insert into public.user_roles (user_id, role_id, assigned_by) values (v_uid, p_to, auth.uid())
    on conflict do nothing;
    delete from public.user_roles where user_id = v_uid and role_id = p_from;
    update public.profiles set permissions_changed_at = now() where user_id = v_uid;
    v_moved := v_moved + 1;
  end loop;

  perform private.audit('role.move_users', 'roles', p_from::text,
    jsonb_build_object('role_id', p_from), jsonb_build_object('role_id', p_to, 'users', v_moved));
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Login lockout (service role only — called by the login server action)
-- ---------------------------------------------------------------------------
create or replace function public.auth_login_precheck(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max int := private.setting_int('security.lockout_max_attempts', 5);
  v_minutes int := private.setting_int('security.lockout_minutes', 15);
  v_last_success timestamptz;
  v_failures int;
  v_last_failure timestamptz;
begin
  select max(at) into v_last_success from public.login_events
   where lower(email) = lower(p_email) and success;

  select count(*), max(at) into v_failures, v_last_failure
  from public.login_events
  where lower(email) = lower(p_email)
    and not success
    and reason is distinct from 'locked'
    and at > greatest(now() - make_interval(mins => v_minutes), coalesce(v_last_success, '-infinity'::timestamptz));

  if v_failures >= v_max then
    return jsonb_build_object('locked', true,
                              'locked_until', v_last_failure + make_interval(mins => v_minutes));
  end if;
  return jsonb_build_object('locked', false, 'remaining', v_max - v_failures);
end;
$$;

create or replace function public.auth_record_login(
  p_email text, p_user_id uuid, p_method text, p_success boolean, p_reason text,
  p_ip text, p_user_agent text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.login_events (user_id, email, method, success, reason, ip, user_agent)
  values (p_user_id, lower(p_email), p_method, p_success, p_reason, p_ip, left(p_user_agent, 400));
  if p_success and p_user_id is not null then
    update public.profiles set last_login_at = now() where user_id = p_user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- First-run setup
-- ---------------------------------------------------------------------------
create or replace function public.setup_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'complete', exists (select 1 from public.settings where key = 'setup.completed_at')
                or private.active_super_admin_count() > 0
  );
$$;

/** Service role only. Turns an existing auth user into the first Super Admin, once. */
create or replace function public.setup_bootstrap_super_admin(
  p_user_id uuid, p_full_name text, p_must_change_password boolean default true
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (public.setup_status() ->> 'complete')::boolean then
    perform private.raise_app_error('SETUP_ALREADY_DONE');
  end if;

  update public.profiles
     set kind = 'staff', status = 'active', full_name = trim(p_full_name),
         must_change_password = p_must_change_password, all_districts = true, permissions_changed_at = now()
   where user_id = p_user_id;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'user');
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role_id)
  select p_user_id, id from public.roles where key = 'super_admin';

  insert into public.settings (key, value, description)
  values ('setup.completed_at', to_jsonb(now()), 'First Super Admin created; /setup is locked');

  perform private.audit('setup.super_admin', 'profiles', p_user_id::text, null, private.user_snapshot(p_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-service
-- ---------------------------------------------------------------------------
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  update public.profiles
     set must_change_password = false,
         status = case when status = 'invited' then 'active'::public.user_status else status end
   where user_id = auth.uid() and deleted_at is null and status in ('active', 'invited');
  if not found then
    perform private.raise_app_error('ACCOUNT_SUSPENDED');
  end if;
  perform private.audit('user.password_changed', 'profiles', auth.uid()::text, null, null);
end;
$$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_locale text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  if p_locale not in ('so', 'en') then
    perform private.raise_app_error('VALIDATION', 'locale');
  end if;
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         phone = coalesce(nullif(trim(p_phone), ''), phone),
         locale = p_locale
   where user_id = auth.uid();
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- ---------------------------------------------------------------------------
-- Idempotency (per user, per action)
-- ---------------------------------------------------------------------------
create or replace function public.idempotency_begin(p_key uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.idempotency_keys;
begin
  -- A pending key older than 5 minutes belongs to a crashed request; let it run again.
  delete from public.idempotency_keys
   where key = p_key and status = 'pending' and created_at < now() - interval '5 minutes';

  insert into public.idempotency_keys (key, user_id, action) values (p_key, auth.uid(), p_action)
  on conflict (key) do nothing;
  if found then
    return jsonb_build_object('state', 'new');
  end if;

  select * into v_row from public.idempotency_keys where key = p_key;
  if v_row.user_id is distinct from auth.uid() or v_row.action <> p_action then
    perform private.raise_app_error('CONFLICT', 'idempotency key reused');
  end if;
  return jsonb_build_object('state', v_row.status, 'result', v_row.result);
end;
$$;

create or replace function public.idempotency_finish(p_key uuid, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.idempotency_keys set status = 'done', result = p_result
   where key = p_key and user_id is not distinct from auth.uid();
$$;

create or replace function public.idempotency_abort(p_key uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.idempotency_keys
   where key = p_key and status = 'pending' and user_id is not distinct from auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable unless granted below.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.has_permission(text),
  public.has_permission(text, text),
  public.my_permissions(),
  public.user_district_ids(),
  public.can_access_district(uuid),
  public.my_session_state(),
  public.admin_validate_user_grants(uuid[], boolean, uuid[]),
  public.admin_provision_user(uuid, text, text, uuid[], boolean, uuid[], boolean),
  public.admin_update_user(uuid, text, text, uuid[], boolean, uuid[]),
  public.admin_authorize_user_action(uuid, text),
  public.admin_apply_user_action(uuid, text),
  public.admin_user_record_counts(uuid),
  public.admin_create_role(text, text, text, text, public.data_scope, jsonb, text[]),
  public.admin_update_role(uuid, text, text, text, text, public.data_scope, jsonb, text[]),
  public.admin_reset_role_to_default(uuid),
  public.admin_delete_role(uuid),
  public.admin_move_role_users(uuid, uuid),
  public.complete_password_change(),
  public.update_my_profile(text, text, text),
  public.mark_notifications_read(uuid[]),
  public.idempotency_begin(uuid, text),
  public.idempotency_finish(uuid, jsonb),
  public.idempotency_abort(uuid)
to authenticated;

grant execute on function public.setup_status() to anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

grant execute on function
  public.auth_login_precheck(text),
  public.auth_record_login(text, uuid, text, boolean, text, text, text),
  public.setup_bootstrap_super_admin(uuid, text, boolean)
to service_role;

-- Future functions are private by default too.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
