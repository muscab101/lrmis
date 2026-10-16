-- ============================================================================
-- 0008 Admin read helpers + Realtime
-- ============================================================================

/** 2FA on/off per user for the users table (auth.mfa_factors isn't exposed via the API). */
create or replace function public.admin_user_mfa_status(p_user_ids uuid[])
returns table (user_id uuid, has_totp boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('users.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'users.view');
  end if;
  return query
    select u, exists (select 1 from auth.mfa_factors f where f.user_id = u and f.status = 'verified')
    from unnest(p_user_ids) u;
end;
$$;

/** Users per role, for the roles list. */
create or replace function public.admin_role_user_counts()
returns table (role_id uuid, users bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('roles.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'roles.view');
  end if;
  return query select r.id, count(ur.user_id) from public.roles r
    left join public.user_roles ur on ur.role_id = r.id group by r.id;
end;
$$;

/** Display names for "created by" / "actor" columns (no other profile data leaks). */
create or replace function public.staff_display_names(p_user_ids uuid[])
returns table (user_id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('users.view') or public.has_permission('audit.view')) then
    perform private.raise_app_error('PERMISSION_DENIED');
  end if;
  return query select p.user_id, p.full_name, p.email from public.profiles p where p.user_id = any (p_user_ids);
end;
$$;

revoke execute on function public.admin_user_mfa_status(uuid[]), public.admin_role_user_counts(),
  public.staff_display_names(uuid[]) from public, anon;
grant execute on function public.admin_user_mfa_status(uuid[]), public.admin_role_user_counts(),
  public.staff_display_names(uuid[]) to authenticated;

-- Realtime for the notifications bell (RLS still applies to what each client receives).
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then
  raise notice 'realtime publication not available: %', sqlerrm;
end $$;
