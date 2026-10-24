-- Every role works on its own: each gets the complete set of permissions its job needs, and nothing from other jobs.
-- Replaces what the roles had (some had drifted: Citizen and Customer Service could open Yet to register, the Auditor
-- could open user and role administration, the Legal and Valuation officers had lost the rights to do their work).
-- Only surveyors create land in the field and owners at the desk stay with surveyors and registrars (0042); registrars
-- assign survey zones and register, they aren't surveyors (so they're never picked to survey).
-- Super Admin is unchanged (it has everything). Data scope (own district / all) is unchanged.

create temporary table role_rebuild (key text primary key, perms text[]) on commit drop;
insert into role_rebuild (key, perms) values
  ('registrar', array['dashboard.view', 'map.view', 'applications.view', 'applications.update', 'applications.approve', 'applications.cancel', 'applications.capture_location', 'parcels.view', 'parcels.update', 'parcels.approve', 'parcels.lock', 'parcels.yet_to_register', 'owners.view', 'owners.create', 'owners.update', 'owners.approve', 'owners.delete', 'surveys.view', 'surveys.approve', 'applications.create', 'transfers.view', 'transfers.create', 'transfers.approve', 'certificates.view', 'certificates.approve', 'certificates.reprint', 'certificates.id_cards', 'documents.view', 'invoices.view', 'invoices.print', 'reports.view', 'reports.assistant']),
  ('land_officer', array['dashboard.view', 'map.view', 'applications.view', 'applications.update', 'applications.approve', 'applications.capture_location', 'parcels.view', 'parcels.yet_to_register', 'owners.view', 'surveys.view', 'surveys.approve', 'documents.view']),
  ('surveyor', array['dashboard.view', 'map.view', 'map.edit_geometry', 'applications.view', 'applications.create', 'applications.capture_location', 'surveys.view', 'surveys.create', 'surveys.update', 'surveys.delete', 'owners.view', 'owners.create', 'owners.update']),
  ('gis_officer', array['dashboard.view', 'map.view', 'map.create', 'map.update', 'map.delete', 'map.approve', 'map.cancel', 'map.export', 'map.print', 'map.edit_geometry', 'surveys.view', 'surveys.approve', 'parcels.view', 'parcels.update', 'parcels.yet_to_register', 'locations.view', 'locations.update', 'applications.capture_location']),
  ('front_desk_clerk', array['dashboard.view', 'applications.view', 'applications.update', 'applications.capture_location', 'owners.view', 'owners.update', 'documents.view', 'documents.create', 'parcels.view', 'transfers.view', 'transfers.create', 'locations.view']),
  ('data_entry_clerk', array['dashboard.view', 'applications.view', 'applications.capture_location', 'owners.view', 'owners.update', 'parcels.view', 'parcels.create', 'parcels.update', 'locations.view']),
  ('valuation_officer', array['dashboard.view', 'map.view', 'parcels.view', 'parcels.yet_to_register', 'valuation.view', 'valuation.create', 'valuation.update', 'valuation.approve', 'valuation.cancel', 'valuation.delete', 'valuation.export', 'valuation.print']),
  ('billing_officer', array['dashboard.view', 'parcels.view', 'owners.view', 'valuation.view', 'billing.view', 'billing.create', 'billing.update', 'invoices.view', 'invoices.create', 'invoices.export', 'invoices.print']),
  ('cashier', array['dashboard.view', 'cashier.view', 'cashier.create', 'cashier.update', 'payments.view', 'payments.create', 'payments.print', 'invoices.view', 'owners.view', 'parcels.yet_to_register']),
  ('revenue_collector', array['dashboard.view', 'map.view', 'payments.view', 'payments.create', 'payments.print', 'invoices.view', 'owners.view', 'parcels.view']),
  ('auditor', array['dashboard.view', 'invoices.view', 'invoices.export', 'payments.view', 'payments.export', 'cashier.view', 'cashier.export', 'billing.view', 'billing.export', 'reconciliation.view', 'reconciliation.create', 'reconciliation.update', 'reconciliation.export', 'accounting.view', 'accounting.export', 'audit.view', 'audit.export', 'reports.view', 'reports.export', 'reports.assistant']),
  ('accountant', array['dashboard.view', 'accounting.view', 'accounting.create', 'accounting.update', 'accounting.approve', 'accounting.cancel', 'accounting.delete', 'accounting.export', 'accounting.print', 'invoices.view', 'payments.view', 'payments.export', 'reconciliation.view', 'reconciliation.create', 'reconciliation.update', 'reports.view', 'reports.export', 'reports.assistant']),
  ('finance_manager', array['dashboard.view', 'billing.view', 'billing.approve', 'billing.cancel', 'invoices.view', 'invoices.create', 'invoices.update', 'invoices.approve', 'invoices.cancel', 'invoices.delete', 'invoices.export', 'invoices.print', 'payments.view', 'payments.approve', 'payments.refund', 'payments.export', 'cashier.view', 'reconciliation.view', 'reconciliation.approve', 'reconciliation.export', 'applications.view', 'reports.view', 'reports.export', 'reports.assistant']),
  ('legal_officer', array['dashboard.view', 'map.view', 'applications.view', 'parcels.view', 'owners.view', 'documents.view', 'disputes.view', 'disputes.create', 'disputes.update', 'disputes.approve', 'disputes.cancel', 'disputes.delete', 'disputes.export', 'disputes.print', 'transfers.view', 'transfers.update']),
  ('planning_officer', array['dashboard.view', 'map.view', 'parcels.view', 'locations.view', 'permits.view', 'permits.create', 'permits.update', 'permits.approve', 'permits.cancel', 'permits.delete', 'permits.export', 'permits.print']),
  ('inspector', array['dashboard.view', 'map.view', 'parcels.view', 'surveys.view', 'permits.view', 'permits.update']),
  ('print_officer', array['dashboard.view', 'certificates.view', 'certificates.print', 'certificates.id_cards', 'documents.view', 'documents.print']),
  ('customer_service', array['dashboard.view', 'map.view', 'applications.view', 'parcels.view', 'owners.view', 'invoices.view', 'payments.view', 'messages.view', 'messages.create']),
  ('executive', array['dashboard.view', 'map.view', 'reports.view', 'reports.export', 'reports.assistant']),
  ('it_support', array['dashboard.view', 'audit.view', 'settings.view', 'users.view', 'users.reset_password', 'users.reset_2fa', 'users.force_signout']),
  ('admin', array['dashboard.view', 'users.view', 'users.create', 'users.update', 'users.delete', 'users.approve', 'users.cancel', 'users.export', 'users.print', 'users.manage', 'users.reset_password', 'users.reset_2fa', 'users.force_signout', 'roles.view', 'roles.create', 'roles.update', 'roles.delete', 'roles.approve', 'roles.cancel', 'roles.export', 'roles.print', 'roles.manage', 'settings.view', 'settings.create', 'settings.update', 'settings.delete', 'settings.approve', 'settings.cancel', 'settings.export', 'settings.print', 'audit.view', 'locations.view', 'locations.create', 'locations.update', 'locations.delete', 'locations.approve', 'locations.cancel', 'locations.export', 'locations.print', 'messages.view', 'messages.update', 'messages.approve', 'messages.cancel', 'documents.view', 'documents.update']),
  ('citizen', array['applications.view', 'applications.create', 'parcels.view', 'invoices.view', 'payments.view', 'payments.create', 'documents.view', 'documents.print', 'disputes.create']);

-- Every key must exist in the catalog.
do $$
declare v text;
begin
  select k into v from role_rebuild r, unnest(r.perms) k where not exists (select 1 from public.permissions p where p.key = k) limit 1;
  if v is not null then
    raise exception 'unknown permission %', v;
  end if;
end;
$$;

delete from public.role_permissions rp using public.roles r, role_rebuild b
 where r.id = rp.role_id and r.key = b.key and not r.is_protected and not (rp.permission_key = any (b.perms));
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r join role_rebuild b on b.key = r.key, unnest(b.perms) k
 where not r.is_protected
on conflict do nothing;
update public.roles r set default_permissions = b.perms from role_rebuild b where b.key = r.key and not r.is_protected;
