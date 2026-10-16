-- ============================================================================
-- 0015 Phase 4 follow-up — Legal Officers decide objections and Finance Managers
-- waive fees on the application page, so both roles need to read applications
-- (still scoped to their districts by RLS).
-- ============================================================================

update public.roles
   set default_permissions = array_append(default_permissions, 'applications.view')
 where key in ('legal_officer', 'finance_manager')
   and not ('applications.view' = any (default_permissions));

insert into public.role_permissions (role_id, permission_key)
select id, 'applications.view' from public.roles where key in ('legal_officer', 'finance_manager')
on conflict do nothing;
