-- Registrars can enter owners too (Add owner on a survey zone, then the owner's land).
insert into public.role_permissions (role_id, permission_key)
select r.id, 'owners.create' from public.roles r where r.key = 'registrar'
on conflict do nothing;
update public.roles set default_permissions = default_permissions || array['owners.create']
 where key = 'registrar' and not ('owners.create' = any (default_permissions));
