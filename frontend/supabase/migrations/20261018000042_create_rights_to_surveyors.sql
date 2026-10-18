-- ============================================================================
-- 0042 Only surveyors (and admins) create owners and land.
--
-- Front-desk and data-entry staff no longer create owners (owners.create) or
-- land parcels / applications (applications.create). They keep viewing and
-- updating them. Surveyors got both rights in 0040; Super Admin and Admin have
-- everything. Citizens still apply for their own land from the portal (Citizen
-- role, unchanged).
-- ============================================================================

delete from public.role_permissions rp
 using public.roles r
 where rp.role_id = r.id
   and r.key in ('front_desk_clerk', 'data_entry_clerk')
   and rp.permission_key in ('owners.create', 'applications.create');

update public.roles
   set default_permissions = array(select x from unnest(default_permissions) x
                                    where x not in ('owners.create', 'applications.create'))
 where key in ('front_desk_clerk', 'data_entry_clerk');
