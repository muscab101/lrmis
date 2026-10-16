-- ============================================================================
-- 0024 Phase 12: go-live hardening — advisor fixes (RLS init-plan, foreign-key indexes)
-- and a system health check for /admin/health.
-- ============================================================================

-- RLS: evaluate auth.uid() once per query, not once per row.
drop policy billing_runs_select on public.billing_runs;
create policy billing_runs_select on public.billing_runs for select to authenticated
  using (public.has_permission('billing.view')
         and (private.user_has_all_districts((select auth.uid())) or district_ids && private.user_district_ids((select auth.uid()))));
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    (public.has_permission('messages.view') and (district_id is null or public.can_access_district(district_id)))
    or exists (select 1 from public.parties p where p.id = messages.party_id and p.citizen_user_id = (select auth.uid()))
  );

-- Indexes for lookup foreign keys (audit "*_by" columns are left unindexed on purpose).
create index if not exists appeals_new_assessment_id_fk_idx on public.appeals (new_assessment_id);
create index if not exists appeals_parcel_id_fk_idx on public.appeals (parcel_id);
create index if not exists application_documents_doc_type_fk_idx on public.application_documents (doc_type);
create index if not exists application_events_actor_id_fk_idx on public.application_events (actor_id);
create index if not exists assessments_rate_id_fk_idx on public.assessments (rate_id);
create index if not exists assessments_supersedes_id_fk_idx on public.assessments (supersedes_id);
create index if not exists billing_runs_fee_type_id_fk_idx on public.billing_runs (fee_type_id);
create index if not exists buildings_grade_id_fk_idx on public.buildings (grade_id);
create index if not exists cashier_shifts_district_id_fk_idx on public.cashier_shifts (district_id);
create index if not exists cashier_shifts_pos_id_fk_idx on public.cashier_shifts (pos_id);
create index if not exists court_orders_dispute_id_fk_idx on public.court_orders (dispute_id);
create index if not exists court_orders_district_id_fk_idx on public.court_orders (district_id);
create index if not exists disputes_district_id_fk_idx on public.disputes (district_id);
create index if not exists invoices_assessment_id_fk_idx on public.invoices (assessment_id);
create index if not exists invoices_fee_type_id_fk_idx on public.invoices (fee_type_id);
create index if not exists issued_documents_district_id_fk_idx on public.issued_documents (district_id);
create index if not exists issued_documents_party_id_fk_idx on public.issued_documents (party_id);
create index if not exists issued_documents_replaces_id_fk_idx on public.issued_documents (replaces_id);
create index if not exists journal_lines_district_id_fk_idx on public.journal_lines (district_id);
create index if not exists leases_district_id_fk_idx on public.leases (district_id);
create index if not exists leases_lessee_party_id_fk_idx on public.leases (lessee_party_id);
create index if not exists liens_district_id_fk_idx on public.liens (district_id);
create index if not exists message_campaigns_district_id_fk_idx on public.message_campaigns (district_id);
create index if not exists message_campaigns_template_code_fk_idx on public.message_campaigns (template_code);
create index if not exists messages_campaign_id_fk_idx on public.messages (campaign_id);
create index if not exists messages_district_id_fk_idx on public.messages (district_id);
create index if not exists messages_template_code_fk_idx on public.messages (template_code);
create index if not exists neighbourhood_rates_district_id_fk_idx on public.neighbourhood_rates (district_id);
create index if not exists parcel_changes_district_id_fk_idx on public.parcel_changes (district_id);
create index if not exists parcel_history_actor_id_fk_idx on public.parcel_history (actor_id);
create index if not exists payment_intents_currency_fk_idx on public.payment_intents (currency);
create index if not exists payment_intents_provider_fk_idx on public.payment_intents (provider);
create index if not exists payment_plan_invoices_invoice_id_fk_idx on public.payment_plan_invoices (invoice_id);
create index if not exists payment_plans_district_id_fk_idx on public.payment_plans (district_id);
create index if not exists payment_plans_parcel_id_fk_idx on public.payment_plans (parcel_id);
create index if not exists payments_currency_fk_idx on public.payments (currency);
create index if not exists payments_district_id_fk_idx on public.payments (district_id);
create index if not exists payments_intent_id_fk_idx on public.payments (intent_id);
create index if not exists payments_pos_id_fk_idx on public.payments (pos_id);
create index if not exists payments_provider_fk_idx on public.payments (provider);
create index if not exists permits_district_id_fk_idx on public.permits (district_id);
create index if not exists permits_fee_invoice_id_fk_idx on public.permits (fee_invoice_id);
create index if not exists permits_parcel_id_fk_idx on public.permits (parcel_id);
create index if not exists points_of_sale_district_id_fk_idx on public.points_of_sale (district_id);
create index if not exists profiles_point_of_sale_id_fk_idx on public.profiles (point_of_sale_id);
create index if not exists provider_webhook_events_payment_id_fk_idx on public.provider_webhook_events (payment_id);
create index if not exists reconciliation_batches_provider_fk_idx on public.reconciliation_batches (provider);
create index if not exists reconciliation_lines_payment_id_fk_idx on public.reconciliation_lines (payment_id);
create index if not exists reprint_requests_fee_invoice_id_fk_idx on public.reprint_requests (fee_invoice_id);
create index if not exists reprint_requests_new_document_id_fk_idx on public.reprint_requests (new_document_id);
create index if not exists transfers_court_order_id_fk_idx on public.transfers (court_order_id);
create index if not exists transfers_district_id_fk_idx on public.transfers (district_id);
create index if not exists transfers_duty_invoice_id_fk_idx on public.transfers (duty_invoice_id);

-- ---------------------------------------------------------------------------
-- System health: integrity and queue checks, each "ok" | "warn" | "fail" with a number.
-- ---------------------------------------------------------------------------
create or replace function public.system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_n numeric;
  v_m numeric;
  v_cron jsonb := '[]'::jsonb;
  procedure_ok boolean;
begin
  if not public.has_permission('settings.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'health');
  end if;

  -- Ledger: total debits equal total credits.
  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_n from public.journal_lines;
  v_checks := v_checks || jsonb_build_object('key', 'ledger_balanced', 'state', case when v_n = 0 then 'ok' else 'fail' end, 'value', v_n);

  -- Debtors control account (1200) equals the sum of open invoice balances.
  select coalesce(sum(l.debit - l.credit), 0) into v_n from public.journal_lines l where l.account = '1200';
  select coalesce(sum(balance), 0) into v_m from public.invoices where status in ('issued', 'partially_paid');
  v_checks := v_checks || jsonb_build_object('key', 'debtors_match', 'state', case when abs(v_n - v_m) < 0.01 then 'ok' else 'warn' end, 'value', v_n - v_m);

  select count(*) into v_n from public.messages where status = 'failed';
  v_checks := v_checks || jsonb_build_object('key', 'messages_failed', 'state', case when v_n = 0 then 'ok' when v_n < 20 then 'warn' else 'fail' end, 'value', v_n);
  select coalesce(extract(epoch from now() - min(created_at)) / 60, 0) into v_n from public.messages where status = 'queued' and run_after <= now();
  v_checks := v_checks || jsonb_build_object('key', 'messages_oldest_queued_min', 'state', case when v_n < 10 then 'ok' when v_n < 60 then 'warn' else 'fail' end, 'value', round(v_n));
  select count(*) into v_n from public.messages where status = 'sending' and run_after < now() - interval '10 minutes';
  v_checks := v_checks || jsonb_build_object('key', 'messages_stuck', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);

  select count(*) into v_n from public.jobs where status = 'failed';
  v_checks := v_checks || jsonb_build_object('key', 'jobs_failed', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);

  select count(*) into v_n from public.payments where status = 'unmatched';
  v_checks := v_checks || jsonb_build_object('key', 'payments_unmatched', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);
  select count(*) into v_n from public.payment_intents where status = 'pending' and expires_at < now();
  v_checks := v_checks || jsonb_build_object('key', 'intents_overdue', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);
  select count(*) into v_n from public.provider_webhook_events where not signature_ok and received_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_object('key', 'webhooks_bad_signature_24h', 'state', case when v_n = 0 then 'ok' when v_n < 10 then 'warn' else 'fail' end, 'value', v_n);
  select count(*) into v_n from public.provider_webhook_events where processed_at is null and received_at < now() - interval '15 minutes' and signature_ok;
  v_checks := v_checks || jsonb_build_object('key', 'webhooks_unprocessed', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);

  -- Staff without a second factor (the app enforces it at sign-in; this shows who hasn't enrolled).
  select count(*) into v_n from public.profiles pr where pr.kind = 'staff' and pr.status = 'active'
     and not exists (select 1 from auth.mfa_factors f where f.user_id = pr.user_id and f.status = 'verified');
  v_checks := v_checks || jsonb_build_object('key', 'staff_without_2fa', 'state', case when v_n = 0 then 'ok' else 'warn' end, 'value', v_n);

  -- Scheduled jobs and their last run.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'last_status', r.status, 'last_run', r.start_time) order by j.jobname), '[]'::jsonb)
      into v_cron
      from cron.job j
      left join lateral (select d.status, d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true;
  exception when others then
    v_cron := '[]'::jsonb;
  end;
  procedure_ok := not exists (select 1 from jsonb_array_elements(v_cron) c where c ->> 'last_status' = 'failed');
  v_checks := v_checks || jsonb_build_object('key', 'cron_last_runs', 'state', case when procedure_ok then 'ok' else 'warn' end,
                                             'value', (select count(*) from jsonb_array_elements(v_cron)));

  return jsonb_build_object(
    'checked_at', now(),
    'checks', v_checks,
    'cron', v_cron,
    'database', jsonb_build_object(
      'size_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
      'parcels', (select count(*) from public.parcels where deleted_at is null),
      'parties', (select count(*) from public.parties where deleted_at is null),
      'invoices', (select count(*) from public.invoices),
      'payments', (select count(*) from public.payments),
      'audit_rows', (select count(*) from public.audit_log),
      'active_staff', (select count(*) from public.profiles where kind = 'staff' and status = 'active')));
end;
$$;
grant execute on function public.system_health() to authenticated;
revoke execute on function public.system_health() from public, anon;
