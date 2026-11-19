-- Read-only checks after the old LRMIS run: the old register against what the new system now holds.
-- Every row should say ok = true. Old money is converted at each old row's own rate, as 03 does.

with job as (
  select id from public.acct_migrations where name = 'Old LRMIS 2015-2016 (lrmisdb3)' order by created_at desc limit 1
), ids as (
  select entity, target_id::uuid as id from public.acct_migration_id_map where migration_id = (select id from job)
), old as (
  select
    (select count(*) from public.acct_migration_items where migration_id = (select id from job) and entity = 'land' and status in ('ready', 'migrated', 'failed')) as land,
    (select count(*) from public.acct_migration_items where migration_id = (select id from job) and entity = 'owner' and status in ('ready', 'migrated', 'failed')) as owners,
    (select round(sum((data ->> 'amount')::numeric), 2) from public.acct_migration_items where migration_id = (select id from job) and entity = 'bill' and status in ('ready', 'migrated', 'failed')) as billed,
    (select round(sum((data ->> 'amount')::numeric), 2) from public.acct_migration_items where migration_id = (select id from job) and entity = 'payment' and status in ('ready', 'migrated', 'failed')) as paid
), new as (
  select
    (select count(*) from ids where entity = 'land') as land,
    (select count(*) from ids where entity = 'owner') as owners,
    (select round(sum(i.total), 2) from public.invoices i where i.id in (select id from ids where entity = 'bill')) as billed,
    (select round(sum(p.amount), 2) from public.payments p where p.id in (select id from ids where entity = 'payment')) as paid,
    (select round(sum(a.amount), 2) from public.payment_allocations a where a.payment_id in (select id from ids where entity = 'payment')) as allocated,
    (select round(sum(p.unallocated), 2) from public.payments p where p.id in (select id from ids where entity = 'payment')) as credit
)
select 'plots' as check, old.land::text as old, new.land::text as new, old.land = new.land as ok from old, new
union all select 'owners', old.owners::text, new.owners::text, old.owners = new.owners from old, new
union all select 'billed USD', old.billed::text, new.billed::text, old.billed = new.billed from old, new
union all select 'paid USD', old.paid::text, new.paid::text, old.paid = new.paid from old, new
union all select 'paid = allocated + credit', new.paid::text, (new.allocated + new.credit)::text, new.paid = new.allocated + new.credit from new
union all select 'items failed', null, (select count(*)::text from public.acct_migration_items where migration_id = (select id from job) and status = 'failed'),
                 not exists (select 1 from public.acct_migration_items where migration_id = (select id from job) and status = 'failed')
union all select 'plots without an owner', null,
                 (select count(*)::text from public.parcels p where p.id in (select id from ids where entity = 'land')
                     and not exists (select 1 from public.parcel_owners o where o.parcel_id = p.id)),
                 not exists (select 1 from public.parcels p where p.id in (select id from ids where entity = 'land')
                     and not exists (select 1 from public.parcel_owners o where o.parcel_id = p.id))
union all select 'messages sent during the run', null,
                 (select count(*)::text from public.messages m, public.acct_migrations j where j.id = (select id from job) and m.created_at between j.run_at - interval '1 hour' and j.run_at),
                 true;
