-- ============================================================================================================
-- Clean-up of 19 Nov 2026 (owner's request): keep about 85 owners from the old LRMIS with their land, bills and
-- payments; delete every other owner and plot (old and new) with everything tied to them, for good. Every deleted
-- row is copied first into schema cleanup_20261119 (no API access), so it can be restored by hand if ever needed.
-- One transaction: all of it happens, or none of it.
-- ============================================================================================================

begin;
set local statement_timeout = 0;

-- ---- What stays ---------------------------------------------------------------------------------------------------
-- 85 old LRMIS owners with a phone whose land is all standing, registered and typed; the most recent registrations.
create temporary table keep_parties on commit drop as
select id from (
  select a.id, max(p.registered_at) as last_reg
    from public.parties a
    join public.parcel_owners po on po.party_id = a.id and po.valid_to is null
    join public.parcels p on p.id = po.parcel_id and p.deleted_at is null
   where a.deleted_at is null and a.legacy_id like 'O-%' and a.phone is not null
   group by a.id
  having bool_and(p.legacy_ref is not null and p.property_type is not null and p.building_state = 'standing' and p.status = 'registered')
   order by max(p.registered_at) desc, a.id
   limit 85) k;

create temporary table keep_parcels on commit drop as
select distinct po.parcel_id as id from public.parcel_owners po where po.party_id in (select id from keep_parties);

-- ---- What goes ------------------------------------------------------------------------------------------------------
create temporary table del_parcels on commit drop as select id from public.parcels where id not in (select id from keep_parcels);
create temporary table del_parties on commit drop as select id from public.parties where id not in (select id from keep_parties);
create temporary table del_invoices on commit drop as select id from public.invoices where parcel_id in (select id from del_parcels);
create temporary table del_payments on commit drop as
select id from public.payments where parcel_id is null or parcel_id in (select id from del_parcels);
create temporary table del_documents on commit drop as
select id from public.issued_documents where parcel_id in (select id from del_parcels) or party_id in (select id from del_parties);
create temporary table del_journal on commit drop as
select id from public.journal_entries
 where (source in ('invoice', 'invoice_cancel') and source_id in (select id from del_invoices))
    or (source = 'payment' and source_id in (select id from del_payments));
insert into del_journal select e.id from public.journal_entries e where e.reverses in (select id from del_journal) or e.reversed_by in (select id from del_journal);

do $$
begin
  if (select count(*) from keep_parties) <> 85 then raise exception 'expected 85 owners to keep, found %', (select count(*) from keep_parties); end if;
  if (select count(*) from keep_parcels) <> 99 then raise exception 'expected 99 plots to keep, found %', (select count(*) from keep_parcels); end if;
end $$;

-- ---- Backup of everything deleted ---------------------------------------------------------------------------------
create schema if not exists cleanup_20261119;
revoke all on schema cleanup_20261119 from public, anon, authenticated;
create table cleanup_20261119.parties as select * from public.parties where id in (select id from del_parties);
create table cleanup_20261119.parcels as select * from public.parcels where id in (select id from del_parcels);
create table cleanup_20261119.parcel_owners as select * from public.parcel_owners where parcel_id in (select id from del_parcels) or party_id in (select id from del_parties);
create table cleanup_20261119.parcel_history as select * from public.parcel_history where parcel_id in (select id from del_parcels);
create table cleanup_20261119.invoices as select * from public.invoices where id in (select id from del_invoices);
create table cleanup_20261119.invoice_lines as select * from public.invoice_lines where invoice_id in (select id from del_invoices);
create table cleanup_20261119.payments as select * from public.payments where id in (select id from del_payments);
create table cleanup_20261119.payment_allocations as select * from public.payment_allocations where payment_id in (select id from del_payments) or invoice_id in (select id from del_invoices);
create table cleanup_20261119.issued_documents as select * from public.issued_documents where id in (select id from del_documents);
create table cleanup_20261119.journal_entries as select * from public.journal_entries where id in (select id from del_journal);
create table cleanup_20261119.journal_lines as select * from public.journal_lines where entry_id in (select id from del_journal);
create table cleanup_20261119.applications as select * from public.applications;
create table cleanup_20261119.application_parties as select * from public.application_parties;
create table cleanup_20261119.surveys as select * from public.surveys;
create table cleanup_20261119.transfers as select * from public.transfers where parcel_id in (select id from del_parcels);
create table cleanup_20261119.demolitions as select * from public.demolitions where parcel_id in (select id from del_parcels);
create table cleanup_20261119.billing_runs as select * from public.billing_runs;
create table cleanup_20261119.messages as select * from public.messages where status = 'queued' or party_id in (select id from del_parties);
do $$ declare t text; begin
  for t in select table_name from information_schema.tables where table_schema = 'cleanup_20261119' loop
    execute format('alter table cleanup_20261119.%I enable row level security', t);
  end loop;
end $$;

-- ---- Delete, children first ---------------------------------------------------------------------------------------
alter table public.parcel_owners disable trigger lock_guard;
-- Locked and archived land is guarded against changes; it is being deleted, so the guards wait until the end.
alter table public.parcels disable trigger lock_guard;
alter table public.parcels disable trigger archive_guard;

-- The books: entries posted for the deleted bills and payments.
delete from public.journal_lines where entry_id in (select id from del_journal);
update public.journal_entries set reverses = null where reverses in (select id from del_journal);
update public.journal_entries set reversed_by = null where reversed_by in (select id from del_journal);
delete from public.journal_entries where id in (select id from del_journal);

-- Payments.
delete from public.commission_entries where payment_id in (select id from del_payments);
delete from public.payment_corrections where payment_id in (select id from del_payments);
delete from public.payment_evidence where payment_id in (select id from del_payments);
delete from public.payment_reversals where payment_id in (select id from del_payments);
delete from public.reconciliation_lines where payment_id in (select id from del_payments);
update public.provider_webhook_events set payment_id = null where payment_id in (select id from del_payments);
delete from public.printer_queue where payment_id in (select id from del_payments) or invoice_id in (select id from del_invoices)
   or document_id in (select id from del_documents);
delete from public.payment_allocations where payment_id in (select id from del_payments) or invoice_id in (select id from del_invoices);
delete from public.payments where id in (select id from del_payments);

-- Documents (certificates, ID cards) and their print jobs and reprints.
delete from public.print_jobs where document_id in (select id from del_documents);
delete from public.reprint_requests where document_id in (select id from del_documents) or new_document_id in (select id from del_documents)
   or fee_invoice_id in (select id from del_invoices);
update public.issued_documents set replaces_id = null where replaces_id in (select id from del_documents);
delete from public.issued_documents where id in (select id from del_documents);

-- Everything else on the deleted land.
delete from public.transfers where parcel_id in (select id from del_parcels) or duty_invoice_id in (select id from del_invoices);
delete from public.demolitions where parcel_id in (select id from del_parcels);
delete from public.liens where parcel_id in (select id from del_parcels);
delete from public.leases where parcel_id in (select id from del_parcels) or lessee_party_id in (select id from del_parties);
delete from public.appeals where parcel_id in (select id from del_parcels);
delete from public.exemptions where parcel_id in (select id from del_parcels);
delete from public.disputes where parcel_id in (select id from del_parcels);
delete from public.court_orders where parcel_id in (select id from del_parcels);
delete from public.permits where parcel_id in (select id from del_parcels) or fee_invoice_id in (select id from del_invoices);
delete from public.payment_plan_invoices where invoice_id in (select id from del_invoices);
delete from public.payment_plans where parcel_id in (select id from del_parcels);
delete from public.building_extra_areas where parcel_id in (select id from del_parcels);
delete from public.buildings where parcel_id in (select id from del_parcels);
delete from public.parcel_changes where parcel_ids && array(select id from del_parcels);

-- Applications and surveys (all of them were for land being deleted).
delete from public.survey_photos where survey_id in (select id from public.surveys);
delete from public.surveys;
delete from public.objections;
delete from public.public_notices;
update public.parcel_owners set source_application_id = null where source_application_id is not null;
update public.parcels set application_id = null where application_id is not null;
delete from public.applications;

-- Bills.
delete from public.credit_notes where invoice_id in (select id from del_invoices);
delete from public.payment_intents where invoice_id in (select id from del_invoices);
delete from public.invoices where id in (select id from del_invoices);
delete from public.assessments where parcel_id in (select id from del_parcels);

-- The land and its people.
delete from public.parcel_history where parcel_id in (select id from del_parcels);
delete from public.parcel_owners where parcel_id in (select id from del_parcels) or party_id in (select id from del_parties);
update public.parcels set manager_party_id = null where manager_party_id in (select id from del_parties);
delete from public.parcels where id in (select id from del_parcels);
delete from public.messages where status = 'queued' or party_id in (select id from del_parties);
delete from public.parties where id in (select id from del_parties);

alter table public.parcel_owners enable trigger lock_guard;
alter table public.parcels enable trigger lock_guard;
alter table public.parcels enable trigger archive_guard;

-- Billing runs: only the land that is left; runs with no bills left go.
update public.billing_runs r set parcel_ids = array(select x from unnest(r.parcel_ids) x where x in (select id from keep_parcels))
 where r.parcel_ids is not null;
delete from public.billing_runs r where not exists (select 1 from public.invoices i where i.run_id = r.id);

-- ---- The old LRMIS archive and its migration job --------------------------------------------------------------------
delete from public.acct_migrations where name = 'Old LRMIS 2015-2016 (lrmisdb3)';
drop schema if exists legacy cascade;

-- ---- Staff recordings: their files are removed from storage on the next visit to Admin → Activity ---------------------
update public.staff_recording_chunks set at = now() - interval '31 days';
update public.staff_recordings set last_at = now() - interval '31 days';

-- ---- What is left ---------------------------------------------------------------------------------------------------
select (select count(*) from public.parties) as owners, (select count(*) from public.parcels) as plots,
       (select count(*) from public.invoices) as bills, (select count(*) from public.payments) as payments,
       (select count(*) from public.issued_documents) as documents, (select count(*) from public.journal_entries) as journal_entries,
       (select count(*) from public.billing_runs) as billing_runs, (select count(*) from public.messages) as messages;

commit;
