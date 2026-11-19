-- ============================================================================================================
-- Backup, Test and Run of the old LRMIS job, from the Supabase SQL editor.
--
-- Why not the buttons: requests from the app stop after 8 seconds (statement_timeout of the `authenticated` role), and
-- ~18,000 old records take longer than that, so the buttons would be cancelled (and rolled back) every time. Here
-- the same functions run as a named Super Admin, with no time limit. Everything is still logged in the Migration
-- center, and Undo still works from its page (taking a run out is much quicker), or from step 4 below.
--
-- 1. Put the Super Admin's email below (one place). 2. Run steps 1–3 one at a time, reading each result.
-- ============================================================================================================

-- Step 1: backup of the books, then a test (everything is done, counted, and put back). Expect "failed": 0.
begin;
set local statement_timeout = 0;
select set_config('request.jwt.claims',
         jsonb_build_object('sub', p.user_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::int)::text, true)
  from public.profiles p where lower(p.email) = lower('SUPER-ADMIN-EMAIL-HERE') and p.kind = 'staff';
select public.acct_migration_backup(m.id) as backup
  from public.acct_migrations m where m.name = 'Old LRMIS 2015-2016 (lrmisdb3)' and m.status <> 'migrated';
select t - 'failures' as test, t -> 'failures' as failures
  from (select public.acct_migration_test(m.id) as t
          from public.acct_migrations m where m.name = 'Old LRMIS 2015-2016 (lrmisdb3)' and m.status <> 'migrated') x;
commit;

-- Step 2: the real run (only after a test of the same preview, which step 1 did).
begin;
set local statement_timeout = 0;
select set_config('request.jwt.claims',
         jsonb_build_object('sub', p.user_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::int)::text, true)
  from public.profiles p where lower(p.email) = lower('SUPER-ADMIN-EMAIL-HERE') and p.kind = 'staff';
select public.acct_migration_run(m.id) - 'failures' as run
  from public.acct_migrations m where m.name = 'Old LRMIS 2015-2016 (lrmisdb3)' and m.status = 'tested';
commit;

-- Step 3: run 04_checks.sql.

-- Step 4 (only to take the run back out): Undo, with a reason.
-- begin;
-- set local statement_timeout = 0;
-- select set_config('request.jwt.claims',
--          jsonb_build_object('sub', p.user_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::int)::text, true)
--   from public.profiles p where lower(p.email) = lower('SUPER-ADMIN-EMAIL-HERE') and p.kind = 'staff';
-- select public.acct_migration_undo(m.id, 'REASON HERE')
--   from public.acct_migrations m where m.name = 'Old LRMIS 2015-2016 (lrmisdb3)' and m.status = 'migrated';
-- commit;
