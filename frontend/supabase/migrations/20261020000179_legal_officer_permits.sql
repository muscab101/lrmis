-- Legal officers handle building permits too (owner decision 2026-11-08): view, apply, update, approve, cancel, print
-- and export (not delete). A permit still needs a second person to approve it; the Planning officer role keeps its rights.
insert into public.role_permissions (role_id, permission_key)
select r.id, k
  from public.roles r
  cross join unnest(array['permits.view', 'permits.create', 'permits.update', 'permits.approve', 'permits.cancel', 'permits.print', 'permits.export']) k
 where r.key = 'legal_officer'
on conflict do nothing;
update public.roles
   set default_permissions = array(select distinct x from unnest(default_permissions
         || array['permits.view', 'permits.create', 'permits.update', 'permits.approve', 'permits.cancel', 'permits.print', 'permits.export']) x)
 where key = 'legal_officer';
