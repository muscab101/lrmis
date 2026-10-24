-- Citizens no longer apply online: the portal shows their land, bills and certificates only.
delete from public.role_permissions rp using public.roles r
 where r.id = rp.role_id and r.key = 'citizen' and rp.permission_key in ('applications.create', 'applications.view');
update public.roles
   set default_permissions = array(select x from unnest(default_permissions) x where x not in ('applications.create', 'applications.view'))
 where key = 'citizen';
