-- ============================================================================
-- 0010 Fixes from the Supabase database advisors
-- ============================================================================

-- Foreign keys used for joins / cascades get covering indexes.
create index if not exists districts_created_by_idx on public.districts (created_by);
create index if not exists districts_manager_user_id_idx on public.districts (manager_user_id);
create index if not exists idempotency_keys_user_id_idx on public.idempotency_keys (user_id);
create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists profiles_created_by_idx on public.profiles (created_by);
create index if not exists regions_created_by_idx on public.regions (created_by);
create index if not exists roles_created_by_idx on public.roles (created_by);
create index if not exists settings_updated_by_idx on public.settings (updated_by);
create index if not exists user_districts_assigned_by_idx on public.user_districts (assigned_by);
create index if not exists user_roles_assigned_by_idx on public.user_roles (assigned_by);

-- One SELECT policy per role on settings instead of two overlapping ones.
drop policy if exists settings_select_public on public.settings;
drop policy if exists settings_select_staff on public.settings;
create policy settings_select_anon on public.settings for select to anon
  using (is_public and not is_secret);
create policy settings_select on public.settings for select to authenticated
  using (not is_secret and (is_public or (select public.has_permission('settings.view'))));

-- Internal tables: only the service role and SECURITY DEFINER functions touch them.
revoke all on public.jobs, public.idempotency_keys from authenticated;
