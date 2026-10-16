-- ============================================================================
-- 0003 Permission catalog + default (system) roles
-- Keep MODULES / ACTIONS / SPECIAL in sync with packages/core/src/permissions.ts
-- (enforced by packages/core/test/permissions-catalog.test.ts).
-- ============================================================================

-- MODULES
with modules(module, sort) as (
  select m, ord from unnest(array[
    'dashboard','map','applications','parcels','owners','surveys','valuation','billing',
    'invoices','payments','cashier','reconciliation','accounting','transfers','disputes',
    'permits','documents','certificates','messages','reports','locations','settings',
    'audit','users','roles'
  ]) with ordinality as t(m, ord)
),
-- ACTIONS
actions(action, sort) as (
  select a, ord from unnest(array[
    'view','create','update','delete','approve','cancel','export','print'
  ]) with ordinality as t(a, ord)
)
insert into public.permissions (key, module, action, is_special, description_en, sort)
select m.module || '.' || a.action, m.module, a.action, false,
       initcap(a.action) || ' ' || replace(m.module, '_', ' '),
       (m.sort * 100 + a.sort)::int
from modules m cross join actions a;

-- SPECIAL
insert into public.permissions (key, module, action, is_special, description_en, description_so, sort) values
  ('payments.refund',       'payments',     'refund',         true, 'Refund payments',              'Celin lacag-bixinta',        1050),
  ('certificates.reprint',  'certificates', 'reprint',        true, 'Reprint certificates',         'Dib u daabac shahaadooyinka', 1850),
  ('map.edit_geometry',     'map',          'edit_geometry',  true, 'Edit parcel geometry on map',  'Wax ka beddel xuduudaha',    250),
  ('users.manage',          'users',        'manage',         true, 'Suspend, reactivate users',    'Maamul isticmaalayaasha',    2450),
  ('users.reset_2fa',       'users',        'reset_2fa',      true, 'Reset a user''s 2FA',          'Dib u deji 2FA',             2451),
  ('users.reset_password',  'users',        'reset_password', true, 'Reset a user''s password',     'Dib u deji furaha sirta',    2452),
  ('users.force_signout',   'users',        'force_signout',  true, 'Sign a user out everywhere',   'Ka saar dhammaan fadhiyada', 2453),
  ('roles.manage',          'roles',        'manage',         true, 'Manage role permissions',      'Maamul doorarka',            2550);

-- ---------------------------------------------------------------------------
-- Default roles. Permission lists are LIKE patterns over permission keys.
-- ---------------------------------------------------------------------------
create function private.seed_role(
  p_key text, p_name_so text, p_name_en text, p_description text, p_colour text,
  p_scope public.data_scope, p_patterns text[],
  p_protected boolean default false, p_grants_all boolean default false
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_perms text[];
begin
  select coalesce(array_agg(key order by sort), '{}') into v_perms
  from public.permissions where key like any (p_patterns);

  insert into public.roles (key, name_so, name_en, description, colour, is_system, is_protected,
                            grants_all, data_scope, default_permissions)
  values (p_key, p_name_so, p_name_en, p_description, p_colour, true, p_protected,
          p_grants_all, p_scope, v_perms)
  returning id into v_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select v_role_id, unnest(v_perms);
end;
$$;

select private.seed_role('super_admin', 'Maamulaha Sare', 'Super Admin',
  'Everything, including settings, payment providers, roles and users.', '#7C3AED', 'all',
  array['%'], true, true);
select private.seed_role('admin', 'Maamule', 'Admin',
  'Users and roles (below Super Admin), settings, locations, templates.', '#1E4FA3', 'all',
  array['users.%','roles.%','settings.%','locations.%','documents.view','documents.update',
        'messages.view','messages.update','audit.view','dashboard.view']);
select private.seed_role('executive', 'Agaasime / Guddoomiye', 'Director / Governor',
  'Read-only dashboards and reports for all districts.', '#0F172A', 'all',
  array['dashboard.view','reports.view','reports.export','map.view']);
select private.seed_role('it_support', 'Taageerada IT', 'IT Support',
  'Reset passwords/2FA, view logs. No money or land data edits.', '#475569', 'all',
  array['users.view','users.reset_password','users.reset_2fa','users.force_signout',
        'audit.view','settings.view','dashboard.view']);
select private.seed_role('data_entry_clerk', 'Karraaniga Xog-gelinta', 'Data Entry Clerk',
  'Bulk import, owner/parcel entry as drafts.', '#64748B', 'district',
  array['owners.view','owners.create','owners.update','parcels.view','parcels.create',
        'parcels.update','applications.view','applications.create','locations.view']);
select private.seed_role('customer_service', 'Adeegga Macaamiisha', 'Customer Service',
  'Answer citizen requests, view parcels/bills, send SMS.', '#0EA5A4', 'district',
  array['parcels.view','owners.view','invoices.view','payments.view','applications.view',
        'messages.view','messages.create','map.view','dashboard.view']);
select private.seed_role('revenue_collector', 'Ururiyaha Canshuurta', 'Revenue / Tax Collector',
  'Door-to-door collection, receipts, notes.', '#16A34A', 'district',
  array['payments.view','payments.create','payments.print','invoices.view','parcels.view',
        'owners.view','map.view']);
select private.seed_role('legal_officer', 'Sarkaalka Sharciga', 'Legal Officer',
  'Disputes, court orders, liens, transfer legal checks.', '#B45309', 'district',
  array['disputes.%','transfers.view','transfers.update','parcels.view','owners.view',
        'documents.view','map.view']);
select private.seed_role('planning_officer', 'Sarkaalka Qorsheynta', 'Planning Officer',
  'Building permits, change of use, zoning layers.', '#0891B2', 'district',
  array['permits.%','parcels.view','map.view','locations.view']);
select private.seed_role('inspector', 'Kormeeraha', 'Inspector',
  'Site inspections for permits and complaints.', '#0E7490', 'district',
  array['permits.view','permits.update','parcels.view','surveys.view','map.view']);
select private.seed_role('citizen', 'Muwaadin', 'Citizen',
  'Apply, upload documents, pay, download receipts and certificates.', '#16A34A', 'own',
  array['applications.view','applications.create','parcels.view','invoices.view',
        'payments.view','payments.create','documents.view','documents.print','disputes.create']);
select private.seed_role('front_desk_clerk', 'Karraaniga Miiska Hore', 'Front-desk Clerk',
  'Register applications at the office, scan documents.', '#2563EB', 'district',
  array['applications.view','applications.create','applications.update','owners.view',
        'owners.create','owners.update','documents.view','documents.create','parcels.view',
        'locations.view']);
select private.seed_role('surveyor', 'Sahamiyaha', 'Surveyor',
  'GPS/satellite boundary capture, measurements, photos.', '#65A30D', 'district',
  array['surveys.view','surveys.create','surveys.update','map.view','map.edit_geometry',
        'parcels.view','applications.view']);
select private.seed_role('gis_officer', 'Sarkaalka GIS', 'GIS Officer',
  'Edit parcel shapes, fix overlaps, manage layers. Approves boundary changes.', '#059669', 'district',
  array['map.%','surveys.view','surveys.approve','parcels.view','parcels.update',
        'locations.view','locations.update']);
select private.seed_role('land_officer', 'Sarkaalka Dhulka', 'Land Officer',
  'Checks documents and survey (first check).', '#1D4ED8', 'district',
  array['applications.view','applications.update','applications.approve','surveys.view',
        'surveys.approve','parcels.view','owners.view','documents.view','map.view']);
select private.seed_role('registrar', 'Diiwaangeliyaha', 'Registrar / District Manager',
  'Final decisions: registration, transfer, corrections, reprints.', '#1E3A8A', 'district',
  array['applications.view','applications.approve','applications.cancel','parcels.view',
        'parcels.update','parcels.approve','transfers.view','transfers.approve',
        'certificates.view','certificates.approve','certificates.reprint','owners.view',
        'documents.view','map.view','dashboard.view','reports.view']);
select private.seed_role('valuation_officer', 'Sarkaalka Qiimeynta', 'Valuation Officer',
  'Rates, property grades, assessments, appeals.', '#7C2D12', 'district',
  array['valuation.%','parcels.view','map.view']);
select private.seed_role('billing_officer', 'Sarkaalka Biilasha', 'Billing Officer',
  'Prepare billing runs.', '#D97706', 'district',
  array['billing.view','billing.create','billing.update','invoices.view','invoices.create',
        'invoices.export','invoices.print','parcels.view']);
select private.seed_role('finance_manager', 'Maareeyaha Maaliyadda', 'Finance Manager',
  'Review billing, waivers, refunds, write-offs.', '#B91C1C', 'all',
  array['billing.view','billing.approve','billing.cancel','invoices.%','payments.view',
        'payments.approve','payments.refund','payments.export','reconciliation.view',
        'reconciliation.approve','reports.view','reports.export','dashboard.view']);
select private.seed_role('cashier', 'Lacag-haye', 'Cashier / Collector',
  'Take payments, receipts, daily cash-up.', '#15803D', 'district',
  array['payments.view','payments.create','payments.print','cashier.view','cashier.create',
        'cashier.update','invoices.view','parcels.view','owners.view']);
select private.seed_role('accountant', 'Xisaabiyaha', 'Accountant',
  'Ledger, reconciliation, period close.', '#9333EA', 'all',
  array['accounting.%','reconciliation.view','reconciliation.create','reconciliation.update',
        'payments.view','payments.export','invoices.view','reports.view','reports.export']);
select private.seed_role('print_officer', 'Sarkaalka Daabacaadda', 'Print Officer',
  'Print certificates and ID cards.', '#334155', 'district',
  array['certificates.view','certificates.print','documents.view','documents.print']);
select private.seed_role('auditor', 'Hanti-dhowraha', 'Auditor',
  'Read-only everything plus the audit log.', '#0F766E', 'all',
  array['%.view','%.export']);

drop function private.seed_role(text, text, text, text, text, public.data_scope, text[], boolean, boolean);
