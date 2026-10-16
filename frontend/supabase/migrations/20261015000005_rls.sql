-- ============================================================================
-- 0005 Row Level Security. Every table has RLS on. Writes to RBAC tables go only
-- through SECURITY DEFINER RPCs (0007), so those tables get SELECT policies only.
-- Policies wrap function calls in (select …) so Postgres evaluates them once per query.
-- ============================================================================

alter table public.regions          enable row level security;
alter table public.districts        enable row level security;
alter table public.profiles         enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.user_districts   enable row level security;
alter table public.login_events     enable row level security;
alter table public.settings         enable row level security;
alter table public.jobs             enable row level security;
alter table public.notifications    enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_log        enable row level security;

-- Defence in depth: anonymous visitors get nothing by default; public pages use explicit
-- grants (public settings now, the public map in Phase 2).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- Clients never write RBAC/audit tables directly.
revoke insert, update, delete on public.profiles, public.roles, public.role_permissions,
  public.user_roles, public.user_districts, public.permissions, public.audit_log,
  public.login_events, public.idempotency_keys, public.jobs
  from authenticated;

-- Geography ------------------------------------------------------------------
create policy regions_select on public.regions for select to authenticated
  using (deleted_at is null or (select public.has_permission('locations.view')));
create policy regions_insert on public.regions for insert to authenticated
  with check ((select public.has_permission('locations.create')));
create policy regions_update on public.regions for update to authenticated
  using ((select public.has_permission('locations.update')))
  with check ((select public.has_permission('locations.update')));

create policy districts_select on public.districts for select to authenticated
  using (deleted_at is null or (select public.has_permission('locations.view')));
create policy districts_insert on public.districts for insert to authenticated
  with check ((select public.has_permission('locations.create')));
create policy districts_update on public.districts for update to authenticated
  using ((select public.has_permission('locations.update')))
  with check ((select public.has_permission('locations.update')));
-- No delete policies: geography is archived with deleted_at.

-- Profiles -------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('users.view')));

-- RBAC -----------------------------------------------------------------------
create policy permissions_select on public.permissions for select to authenticated
  using (true);

-- Role names/colours are needed to render badges for any signed-in user.
create policy roles_select on public.roles for select to authenticated
  using (true);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (
    (select public.has_permission('roles.view'))
    or role_id in (select ur.role_id from public.user_roles ur where ur.user_id = (select auth.uid()))
  );

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('users.view')));

create policy user_districts_select on public.user_districts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('users.view')));

-- Login events ---------------------------------------------------------------
create policy login_events_select on public.login_events for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_permission('audit.view'))
    or (select public.has_permission('users.view'))
  );

-- Settings -------------------------------------------------------------------
grant select on public.settings to anon;
create policy settings_select_public on public.settings for select to anon, authenticated
  using (is_public and not is_secret);
create policy settings_select_staff on public.settings for select to authenticated
  using ((select public.has_permission('settings.view')) and not is_secret);
create policy settings_update on public.settings for update to authenticated
  using ((select public.has_permission('settings.update')))
  with check ((select public.has_permission('settings.update')));

-- Jobs / idempotency: service role and SECURITY DEFINER functions only (no policies).

-- Notifications --------------------------------------------------------------
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Audit ----------------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_permission('audit.view')));
