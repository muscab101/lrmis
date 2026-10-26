-- The Finance Manager approves commission rules and payouts, which live under Accounting → Commissions, so the role
-- can open Accounting (view only: recording and posting stay with the accountant).
insert into public.role_permissions (role_id, permission_key)
select r.id, 'accounting.view' from public.roles r where r.key = 'finance_manager'
on conflict do nothing;
update public.roles set default_permissions = array_append(default_permissions, 'accounting.view')
 where key = 'finance_manager' and not ('accounting.view' = any (default_permissions));
