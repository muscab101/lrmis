-- ============================================================================
-- 0030 Audit fix: the billing_runs read policy called private.user_has_all_districts /
-- private.user_district_ids, which signed-in users may not execute on Supabase, so every
-- query touching billing runs (run pages, invoice detail and print) failed with
-- "permission denied". Use the public district check instead.
-- ============================================================================

drop policy billing_runs_select on public.billing_runs;
create policy billing_runs_select on public.billing_runs for select to authenticated
  using (public.has_permission('billing.view')
         and (coalesce(public.can_access_district(null), false)
              or exists (select 1 from unnest(district_ids) d(id) where public.can_access_district(d.id))));
