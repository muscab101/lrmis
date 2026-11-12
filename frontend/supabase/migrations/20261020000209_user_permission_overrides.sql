-- Powers per user, on top of the role: the Super Admin can give one user a power their role doesn't have, or take
-- one of the role's powers away from that user only. What a user can do = their roles' powers + given − taken away.
-- A Super Admin (a role with every power) always has everything.

create table public.user_permission_overrides (
  user_id         uuid not null references auth.users (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  allow           boolean not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  primary key (user_id, permission_key)
);
create index user_permission_overrides_key_idx on public.user_permission_overrides (permission_key);
create index user_permission_overrides_created_by_idx on public.user_permission_overrides (created_by);
create trigger audit after insert or update or delete on public.user_permission_overrides for each row execute function private.audit_row();

alter table public.user_permission_overrides enable row level security;
revoke all on public.user_permission_overrides from public, anon;
revoke insert, update, delete on public.user_permission_overrides from authenticated;
grant select on public.user_permission_overrides to authenticated;
create policy user_permission_overrides_select on public.user_permission_overrides for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('users.view'));

/** A user's powers from their roles, plus the ones given to them, minus the ones taken away (not for a Super Admin). */
create or replace function private.user_role_perms(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(k order by k), '{}') from (
    select rp.permission_key as k
      from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
     where ur.user_id = p_user_id
    union
    select o.permission_key from public.user_permission_overrides o where o.user_id = p_user_id and o.allow
    except
    select o.permission_key from public.user_permission_overrides o where o.user_id = p_user_id and not o.allow
  ) x;
$$;
revoke all on function private.user_role_perms(uuid) from public, anon, authenticated;

create or replace function private.user_permissions(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.user_grants_all(p_user_id) then (select array_agg(key order by key) from public.permissions)
    else private.user_role_perms(p_user_id)
  end;
$$;

create or replace function private.user_has_permission(p_user_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_grants_all(p_user_id) or p_key = any (private.user_role_perms(p_user_id));
$$;

-- The signed-in user's powers (read once per request) include what was given or taken away.
do $do$
declare
  v text := pg_get_functiondef('private.viewer_load()'::regprocedure);
  v_new text := replace(v,
    E'else coalesce((select array_agg(distinct rp.permission_key) from public.user_roles ur\n                    join public.role_permissions rp on rp.role_id = ur.role_id where ur.user_id = v_uid), ''{}'')',
    'else private.user_role_perms(v_uid)');
begin
  if v_new = v then
    raise exception 'viewer_load: text not found';
  end if;
  execute v_new;
end;
$do$;

/**
 * Super Admin: set one user's extra powers (given) and the role powers taken away from them. Replaces what was set
 * before. Returns the user's powers now.
 */
create function public.user_permissions_set(p_user uuid, p_allow text[], p_deny text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad text;
begin
  if not private.user_grants_all(auth.uid()) or not private.caller_is_active() then
    perform private.raise_app_error('PERMISSION_DENIED', 'super_admin');
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user and kind = 'staff' and deleted_at is null) then
    perform private.raise_app_error('NOT_FOUND', 'user');
  end if;
  if private.user_grants_all(p_user) then
    perform private.raise_app_error('CONFLICT', 'super_admin');
  end if;
  select k into v_bad from unnest(coalesce(p_allow, '{}') || coalesce(p_deny, '{}')) k
   where not exists (select 1 from public.permissions p where p.key = k) limit 1;
  if v_bad is not null then
    perform private.raise_app_error('VALIDATION', 'permission');
  end if;
  if coalesce(p_allow, '{}') && coalesce(p_deny, '{}') then
    perform private.raise_app_error('VALIDATION', 'permission');
  end if;
  delete from public.user_permission_overrides o
   where o.user_id = p_user
     and not (o.permission_key = any (case when o.allow then coalesce(p_allow, '{}') else coalesce(p_deny, '{}') end));
  insert into public.user_permission_overrides (user_id, permission_key, allow, created_by)
  select p_user, k, true, auth.uid() from unnest(coalesce(p_allow, '{}')) k
  union
  select p_user, k, false, auth.uid() from unnest(coalesce(p_deny, '{}')) k
  on conflict (user_id, permission_key) do update set allow = excluded.allow, created_by = excluded.created_by, created_at = now()
    where public.user_permission_overrides.allow is distinct from excluded.allow;
  return private.user_permissions(p_user);
end;
$$;
revoke all on function public.user_permissions_set(uuid, text[], text[]) from public, anon;
grant execute on function public.user_permissions_set(uuid, text[], text[]) to authenticated;
