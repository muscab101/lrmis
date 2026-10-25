-- ============================================================================
-- 0102 Permissions the system checks but no role held (only super admin could use them):
--   cashier.approve      approve a cashier's closed shift      → Finance Manager
--   certificates.cancel  cancel a certificate or ID card       → Registrar
--   transfers.cancel     cancel a transfer                     → Registrar, Legal Officer
-- Also added to each role's defaults so "Reset to default" keeps them.
-- ============================================================================

insert into public.role_permissions (role_id, permission_key)
select r.id, g.perm
  from (values ('finance_manager', 'cashier.approve'),
               ('registrar', 'certificates.cancel'),
               ('registrar', 'transfers.cancel'),
               ('legal_officer', 'transfers.cancel')) g(role_key, perm)
  join public.roles r on r.key = g.role_key and not r.is_protected
on conflict do nothing;

update public.roles r
   set default_permissions = (select array_agg(distinct p order by p) from unnest(r.default_permissions || g.perms) p)
  from (values ('finance_manager', array['cashier.approve']),
               ('registrar', array['certificates.cancel', 'transfers.cancel']),
               ('legal_officer', array['transfers.cancel'])) g(role_key, perms)
 where r.key = g.role_key and not r.is_protected;
