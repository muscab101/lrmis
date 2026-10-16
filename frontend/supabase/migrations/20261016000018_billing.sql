-- ============================================================================
-- 0018 Phase 6 — Billing runs, invoices, credit notes, penalties, payment plans (§4.7).
-- Run: draft (preview) → submitted → approved (finance, someone else) → generate → issued.
-- One invoice per parcel / fee type / period is enforced by a unique constraint, so
-- generation is idempotent. Payments (Phase 7) settle invoices through
-- private.invoice_apply_payment().
-- ============================================================================

create type public.billing_run_status as enum ('draft', 'submitted', 'approved', 'generating', 'issued', 'cancelled');
create type public.invoice_status as enum ('issued', 'partially_paid', 'paid', 'cancelled');
create type public.invoice_line_kind as enum ('tax', 'service', 'fee', 'penalty', 'credit');
create type public.payment_plan_status as enum ('pending', 'active', 'completed', 'rejected', 'cancelled', 'defaulted');

insert into public.settings (key, value, description) values
  ('billing.due_days', '60', 'Days from issue to due date when a run does not set one'),
  ('billing.penalty_pct', '5', 'Late penalty, % of the unpaid balance, applied once after the grace period'),
  ('billing.penalty_grace_days', '30', 'Days after the due date before the late penalty applies'),
  ('billing.early_discount_pct', '5', 'Discount for paying in full within the early-payment window (applied by Phase 7 payments)'),
  ('billing.early_discount_days', '30', 'Days after issue during which the early-payment discount applies'),
  ('billing.plan_max_instalments', '12', 'Longest payment plan (instalments)')
on conflict (key) do nothing;

-- Shared gapless counters (BR-, INV-, CN-, PP- numbers).
create table public.serial_counters (
  scope        text primary key,
  last_serial  int not null default 0
);

create or replace function private.next_serial(p_scope text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  insert into public.serial_counters (scope) values (p_scope) on conflict do nothing;
  update public.serial_counters set last_serial = last_serial + 1 where scope = p_scope returning last_serial into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Billing runs
-- ---------------------------------------------------------------------------
create table public.billing_runs (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,
  year               int not null check (year between 2000 and 2100),
  period             text not null check (period ~ '^\d{4}(-(Q[1-4]|H[12]|(0[1-9]|1[0-2])))?$'),
  fee_type_id        uuid not null references public.fee_types (id),
  district_ids       uuid[] not null check (cardinality(district_ids) > 0),
  neighbourhood_ids  uuid[] not null default '{}',
  issue_date         date not null default current_date,
  due_date           date not null,
  status             public.billing_run_status not null default 'draft',
  preview            jsonb not null default '{}'::jsonb,
  invoice_count      int not null default 0,
  total              numeric(16, 2) not null default 0,
  note               text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  submitted_at       timestamptz,
  approved_by        uuid references auth.users (id) on delete set null,
  approved_at        timestamptz,
  issued_at          timestamptz,
  cancelled_by       uuid references auth.users (id) on delete set null,
  cancelled_at       timestamptz,
  cancel_reason      text,
  check (due_date >= issue_date)
);
create index billing_runs_status_idx on public.billing_runs (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  parcel_id           uuid not null references public.parcels (id),
  district_id         uuid not null references public.districts (id),
  fee_type_id         uuid not null references public.fee_types (id),
  period              text not null,
  run_id              uuid references public.billing_runs (id),
  assessment_id       uuid references public.assessments (id),
  issue_date          date not null default current_date,
  due_date            date not null,
  discount_until      date,
  early_discount_pct  numeric(5, 2) not null default 0,
  currency            text not null default 'USD',
  total               numeric(14, 2) not null check (total >= 0),
  paid                numeric(14, 2) not null default 0 check (paid >= 0),
  credited            numeric(14, 2) not null default 0 check (credited >= 0),
  balance             numeric(14, 2) generated always as (greatest(total - paid - credited, 0)) stored,
  status              public.invoice_status not null default 'issued',
  penalty_applied_at  timestamptz,
  note                text,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (parcel_id, fee_type_id, period)
);
create index invoices_parcel_idx on public.invoices (parcel_id);
create index invoices_run_idx on public.invoices (run_id);
create index invoices_open_idx on public.invoices (district_id, due_date) where status in ('issued', 'partially_paid');

-- Bearer secret behind the invoice QR / public pay page; never readable through the API.
create table public.invoice_tokens (
  invoice_id  uuid primary key references public.invoices (id) on delete cascade,
  token       text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);

create or replace function private.invoice_token_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_tokens (invoice_id) values (new.id);
  return new;
end;
$$;
create trigger invoice_token after insert on public.invoices for each row execute function private.invoice_token_insert();

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  kind         public.invoice_line_kind not null,
  description  text not null,
  amount       numeric(14, 2) not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

create table public.credit_notes (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  invoice_id     uuid not null references public.invoices (id),
  amount         numeric(14, 2) not null check (amount > 0),
  reason         text not null check (length(trim(reason)) >= 5),
  status         public.decision_status not null default 'pending',
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text
);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);

-- ---------------------------------------------------------------------------
-- Payment plans
-- ---------------------------------------------------------------------------
create table public.payment_plans (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  parcel_id      uuid not null references public.parcels (id),
  district_id    uuid not null references public.districts (id),
  total          numeric(14, 2) not null check (total > 0),
  instalments    int not null check (instalments between 2 and 36),
  start_date     date not null,
  status         public.payment_plan_status not null default 'pending',
  note           text,
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text
);

create table public.payment_plan_invoices (
  plan_id     uuid not null references public.payment_plans (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id),
  primary key (plan_id, invoice_id)
);

create table public.payment_plan_installments (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.payment_plans (id) on delete cascade,
  seq       int not null,
  due_date  date not null,
  amount    numeric(14, 2) not null check (amount > 0),
  paid      numeric(14, 2) not null default 0 check (paid >= 0),
  unique (plan_id, seq)
);

create trigger set_updated_at before update on public.invoices for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.billing_runs for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.invoices for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.credit_notes for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.payment_plans for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create or replace function private.can_view_invoice_district(p_district uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.has_permission('invoices.view') or public.has_permission('billing.view')) and public.can_access_district(p_district);
$$;

alter table public.serial_counters enable row level security;
alter table public.invoice_tokens enable row level security;
alter table public.billing_runs enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.credit_notes enable row level security;
alter table public.payment_plans enable row level security;
alter table public.payment_plan_invoices enable row level security;
alter table public.payment_plan_installments enable row level security;

revoke all on public.serial_counters, public.billing_runs, public.invoices, public.invoice_lines, public.credit_notes,
  public.payment_plans, public.payment_plan_invoices, public.payment_plan_installments from anon;
revoke insert, update, delete on public.serial_counters, public.billing_runs, public.invoices, public.invoice_lines,
  public.credit_notes, public.payment_plans, public.payment_plan_invoices, public.payment_plan_installments from authenticated;
revoke all on public.serial_counters, public.invoice_tokens from authenticated, anon;

create policy billing_runs_select on public.billing_runs for select to authenticated
  using (public.has_permission('billing.view')
         and (private.user_has_all_districts(auth.uid()) or district_ids && private.user_district_ids(auth.uid())));
create policy invoices_select on public.invoices for select to authenticated
  using (private.can_view_invoice_district(district_id) or private.is_parcel_owner(parcel_id));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and (private.can_view_invoice_district(i.district_id) or private.is_parcel_owner(i.parcel_id))));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and private.can_view_invoice_district(i.district_id)));
create policy payment_plans_select on public.payment_plans for select to authenticated
  using (private.can_view_invoice_district(district_id) or private.is_parcel_owner(parcel_id));
create policy payment_plan_invoices_select on public.payment_plan_invoices for select to authenticated
  using (exists (select 1 from public.payment_plans p where p.id = plan_id
                 and (private.can_view_invoice_district(p.district_id) or private.is_parcel_owner(p.parcel_id))));
create policy payment_plan_installments_select on public.payment_plan_installments for select to authenticated
  using (exists (select 1 from public.payment_plans p where p.id = plan_id
                 and (private.can_view_invoice_district(p.district_id) or private.is_parcel_owner(p.parcel_id))));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.invoice_number(p_year int)
returns text
language sql
security definer
set search_path = ''
as $$
  select 'INV-' || p_year || '-' || lpad(private.next_serial('INV-' || p_year)::text, 6, '0');
$$;

/** Status follows the money: paid in full, partly, or not at all (cancelled stays cancelled). */
create or replace function private.invoice_refresh_status(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoices
     set status = case when status = 'cancelled' then 'cancelled'::public.invoice_status
                       when total - paid - credited <= 0 then 'paid'::public.invoice_status
                       when paid > 0 or credited > 0 then 'partially_paid'::public.invoice_status
                       else 'issued'::public.invoice_status end
   where id = p_id;
$$;

/** Hand-off for Phase 7: record money against an invoice (returns the amount actually applied). */
create or replace function private.invoice_apply_payment(p_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_apply numeric;
begin
  select * into v from public.invoices where id = p_id for update;
  if v.id is null or v.status = 'cancelled' then
    return 0;
  end if;
  v_apply := least(greatest(p_amount, 0), v.balance);
  update public.invoices set paid = paid + v_apply where id = p_id;
  perform private.invoice_refresh_status(p_id);
  return v_apply;
end;
$$;

/** What a run would bill: one entry per parcel in scope, plus exceptions. */
create or replace function private.billing_run_candidates(p_run public.billing_runs)
returns table (parcel_id uuid, district_id uuid, assessment_id uuid, amount numeric, lines jsonb, exception text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fee public.fee_types;
begin
  select * into v_fee from public.fee_types where id = p_run.fee_type_id;
  return query
  with scope as (
    select p.id, p.district_id, p.pun
    from public.parcels p
    where p.deleted_at is null and p.status in ('registered', 'disputed')
      and p.district_id = any (p_run.district_ids)
      and (cardinality(p_run.neighbourhood_ids) = 0 or p.neighbourhood_id = any (p_run.neighbourhood_ids))
  )
  select s.id, s.district_id, a.id,
         case when v_fee.code = 'property_tax' then a.total else v_fee.amount end,
         case when v_fee.code = 'property_tax' then
                jsonb_build_array(
                  jsonb_build_object('kind', 'tax', 'description', 'Property tax ' || p_run.period || ' (' || a.number || ')',
                                     'amount', a.total - a.service_charge),
                  jsonb_build_object('kind', 'service', 'description', 'Service charge ' || p_run.period, 'amount', a.service_charge))
              else jsonb_build_array(jsonb_build_object('kind', 'fee', 'description', v_fee.name_en || ' ' || p_run.period, 'amount', v_fee.amount))
         end,
         case
           when exists (select 1 from public.invoices i where i.parcel_id = s.id and i.fee_type_id = p_run.fee_type_id and i.period = p_run.period) then 'already_invoiced'
           when v_fee.code = 'property_tax' and a.id is null then 'no_assessment'
           when (case when v_fee.code = 'property_tax' then a.total else v_fee.amount end) <= 0 then 'zero_amount'
           else null
         end
  from scope s
  left join public.assessments a on a.parcel_id = s.id and a.year = p_run.year and a.status = 'issued';
end;
$$;

create or replace function private.billing_run_preview(p_run public.billing_runs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'parcels', count(*),
    'count', count(*) filter (where exception is null),
    'total', coalesce(sum(amount) filter (where exception is null), 0),
    'exceptions', jsonb_build_object(
      'already_invoiced', count(*) filter (where exception = 'already_invoiced'),
      'no_assessment', count(*) filter (where exception = 'no_assessment'),
      'zero_amount', count(*) filter (where exception = 'zero_amount')),
    'at', now())
  from private.billing_run_candidates(p_run);
$$;

create or replace function private.billing_run_scope(p_id uuid)
returns public.billing_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
  v_d uuid;
begin
  select * into v from public.billing_runs where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'run');
  end if;
  foreach v_d in array v.district_ids loop
    if not public.can_access_district(v_d) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end loop;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Billing run RPCs
-- ---------------------------------------------------------------------------
create or replace function public.billing_run_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
  v_year int := (p ->> 'year')::int;
  v_fee uuid := (p ->> 'fee_type_id')::uuid;
  v_districts uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'district_ids', '[]'))::uuid);
  v_nbhds uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'neighbourhood_ids', '[]'))::uuid);
  v_d uuid;
  v_due date := nullif(p ->> 'due_date', '')::date;
begin
  perform private.assert_permission('billing.create');
  if v_year is null or v_year < 2000 or v_year > 2100 then
    perform private.raise_app_error('VALIDATION', 'year');
  end if;
  if not exists (select 1 from public.fee_types where id = v_fee and active and interval <> 'one_off') then
    perform private.raise_app_error('VALIDATION', 'fee_type');
  end if;
  if cardinality(v_districts) = 0 then
    perform private.raise_app_error('VALIDATION', 'districts');
  end if;
  foreach v_d in array v_districts loop
    if not public.can_access_district(v_d) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end loop;
  if exists (select 1 from unnest(v_nbhds) n where not exists (
               select 1 from public.neighbourhoods x where x.id = n and x.district_id = any (v_districts))) then
    perform private.raise_app_error('VALIDATION', 'neighbourhoods');
  end if;
  v_due := coalesce(v_due, current_date + private.setting_int('billing.due_days', 60));
  if v_due < current_date then
    perform private.raise_app_error('VALIDATION', 'due_date');
  end if;

  insert into public.billing_runs (number, year, period, fee_type_id, district_ids, neighbourhood_ids, due_date, note, created_by)
  values ('BR-' || v_year || '-' || lpad(private.next_serial('BR-' || v_year)::text, 3, '0'), v_year,
          coalesce(nullif(p ->> 'period', ''), v_year::text), v_fee, v_districts, v_nbhds, v_due, nullif(trim(p ->> 'note'), ''), auth.uid())
  returning * into v;
  update public.billing_runs set preview = private.billing_run_preview(v) where id = v.id returning * into v;
  return jsonb_build_object('id', v.id, 'number', v.number, 'preview', v.preview);
end;
$$;

create or replace function public.billing_run_refresh(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.view');
  v := private.billing_run_scope(p_id);
  if v.status not in ('draft', 'submitted', 'approved') then
    return v.preview;
  end if;
  update public.billing_runs set preview = private.billing_run_preview(v) where id = p_id returning * into v;
  return v.preview;
end;
$$;

create or replace function public.billing_run_submit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.create');
  v := private.billing_run_scope(p_id);
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.billing_runs set status = 'submitted', submitted_at = now(), preview = private.billing_run_preview(v) where id = p_id
  returning * into v;
  if (v.preview ->> 'count')::int = 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_to_bill');
  end if;
end;
$$;

create or replace function public.billing_run_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.approve');
  v := private.billing_run_scope(p_id);
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  update public.billing_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
end;
$$;

/**
 * Generate the invoices of an approved run. Idempotent: the unique (parcel, fee, period)
 * constraint skips anything already invoiced, so a retry after a failure is safe.
 */
create or replace function public.billing_run_generate(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
  c record;
  v_inv uuid;
  v_count int := 0;
  v_total numeric := 0;
  v_line jsonb;
  v_disc_pct numeric := private.setting_numeric('billing.early_discount_pct', 0);
  v_disc_days int := private.setting_int('billing.early_discount_days', 30);
begin
  perform private.assert_permission('billing.approve');
  v := private.billing_run_scope(p_id);
  if v.status not in ('approved', 'generating') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.billing_runs set status = 'generating', issue_date = current_date where id = p_id;

  for c in select * from private.billing_run_candidates(v) where exception is null loop
    insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, run_id, assessment_id, issue_date, due_date,
                                 discount_until, early_discount_pct, total, created_by)
    values (private.invoice_number(v.year), c.parcel_id, c.district_id, v.fee_type_id, v.period, v.id, c.assessment_id,
            current_date, v.due_date, case when v_disc_pct > 0 then current_date + v_disc_days end, v_disc_pct, c.amount, auth.uid())
    on conflict (parcel_id, fee_type_id, period) do nothing
    returning id into v_inv;
    if v_inv is not null then
      for v_line in select * from jsonb_array_elements(c.lines) loop
        if (v_line ->> 'amount')::numeric <> 0 then
          insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
          values (v_inv, (v_line ->> 'kind')::public.invoice_line_kind, v_line ->> 'description', (v_line ->> 'amount')::numeric, auth.uid());
        end if;
      end loop;
      perform private.parcel_event(c.parcel_id, 'invoiced', null, jsonb_build_object('invoice_id', v_inv, 'period', v.period, 'total', c.amount));
      insert into public.jobs (kind, payload, created_by)
      values ('sms.invoice_issued', jsonb_build_object('invoice_id', v_inv), auth.uid());
      v_count := v_count + 1;
      v_total := v_total + c.amount;
    end if;
    v_inv := null;
  end loop;

  update public.billing_runs
     set status = 'issued', issued_at = now(),
         invoice_count = (select count(*) from public.invoices where run_id = p_id),
         total = (select coalesce(sum(total), 0) from public.invoices where run_id = p_id)
   where id = p_id;
  return jsonb_build_object('created', v_count, 'total', v_total);
end;
$$;

create or replace function public.billing_run_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  v := private.billing_run_scope(p_id);
  if v.created_by is distinct from auth.uid() then
    perform private.assert_permission('billing.cancel');
  else
    perform private.assert_permission('billing.create');
  end if;
  if v.status not in ('draft', 'submitted', 'approved') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.billing_runs set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Single invoices (one-off fees), cancellation, credit notes, penalties
-- ---------------------------------------------------------------------------
create or replace function public.invoice_create(p_parcel uuid, p_fee_type uuid, p_amount numeric, p_note text default null, p_due date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_fee public.fee_types;
  v_amount numeric;
  v_id uuid;
  v_number text;
  v_period text;
begin
  perform private.assert_permission('invoices.create');
  select * into v_p from public.parcels where id = p_parcel and deleted_at is null;
  if v_p.id is null or not public.can_access_district(v_p.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  select * into v_fee from public.fee_types where id = p_fee_type and active;
  if v_fee.id is null or v_fee.code = 'property_tax' then
    perform private.raise_app_error('VALIDATION', 'fee_type');
  end if;
  v_amount := coalesce(p_amount, v_fee.amount);
  if v_amount is null or v_amount <= 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  -- One-off fees can recur (e.g. two reprints), so the period is the date plus a serial.
  v_period := to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-' || v_fee.code || '-' || p_parcel);
  v_number := private.invoice_number(extract(year from current_date)::int);
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (v_number, p_parcel, v_p.district_id, p_fee_type, v_period, current_date,
          coalesce(p_due, current_date + 30), round(v_amount, 2), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
  values (v_id, 'fee', v_fee.name_en || coalesce(' — ' || nullif(trim(p_note), ''), ''), round(v_amount, 2), auth.uid());
  perform private.parcel_event(p_parcel, 'invoiced', p_note, jsonb_build_object('invoice_id', v_id, 'fee', v_fee.code, 'total', v_amount));
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.invoice_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
begin
  perform private.assert_permission('invoices.cancel');
  select * into v from public.invoices where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  if v.status = 'cancelled' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.paid > 0 then
    perform private.raise_app_error('CONFLICT', 'has_payments');
  end if;
  if exists (select 1 from public.payment_plan_invoices ppi join public.payment_plans pp on pp.id = ppi.plan_id
             where ppi.invoice_id = p_id and pp.status in ('pending', 'active')) then
    perform private.raise_app_error('CONFLICT', 'in_payment_plan');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  perform private.assert_maker_checker(v.created_by);
  update public.invoices set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_id;
  perform private.parcel_event(v.parcel_id, 'invoice_cancelled', p_reason, jsonb_build_object('invoice_id', p_id));
end;
$$;

create or replace function public.credit_note_request(p_invoice uuid, p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_id uuid;
  v_pending numeric;
begin
  perform private.assert_permission('invoices.create');
  select * into v from public.invoices where id = p_invoice;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  if v.status = 'cancelled' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  select coalesce(sum(amount), 0) into v_pending from public.credit_notes where invoice_id = p_invoice and status = 'pending';
  if p_amount is null or p_amount <= 0 or p_amount > v.balance - v_pending then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  insert into public.credit_notes (number, invoice_id, amount, reason, requested_by)
  values ('CN-' || extract(year from current_date)::int || '-' || lpad(private.next_serial('CN-' || extract(year from current_date)::int)::text, 5, '0'),
          p_invoice, round(p_amount, 2), trim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.credit_note_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.credit_notes;
  v_inv public.invoices;
begin
  perform private.assert_permission('invoices.approve');
  select * into v from public.credit_notes where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'credit_note');
  end if;
  select * into v_inv from public.invoices where id = v.invoice_id for update;
  if not public.can_access_district(v_inv.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'credit_note');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  if p_approve and v.amount > v_inv.balance then
    perform private.raise_app_error('CONFLICT', 'exceeds_balance');
  end if;
  update public.credit_notes
     set status = case when p_approve then 'approved'::public.decision_status else 'rejected'::public.decision_status end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_approve then
    update public.invoices set credited = credited + v.amount where id = v.invoice_id;
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v.invoice_id, 'credit', 'Credit note ' || v.number || ': ' || v.reason, -v.amount, auth.uid());
    perform private.invoice_refresh_status(v.invoice_id);
    perform private.parcel_event(v_inv.parcel_id, 'credit_note_approved', v.reason, jsonb_build_object('invoice_id', v.invoice_id, 'amount', v.amount));
  end if;
end;
$$;

/**
 * Apply the one-time late penalty to invoices past due + grace with a balance, except those in an
 * active or pending payment plan. Run daily (pg_cron) or by billing staff. Returns how many were charged.
 */
create or replace function public.apply_late_penalties(p_as_of date default current_date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pct numeric := private.setting_numeric('billing.penalty_pct', 0);
  v_grace int := private.setting_int('billing.penalty_grace_days', 30);
  r record;
  v_amount numeric;
  v_count int := 0;
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null and current_user in ('postgres', 'service_role');
begin
  if not v_service then
    perform private.assert_permission('billing.update');
  end if;
  if v_pct <= 0 then
    return 0;
  end if;
  for r in
    select i.id, i.parcel_id, i.balance, i.number from public.invoices i
    where i.status in ('issued', 'partially_paid') and i.balance > 0 and i.penalty_applied_at is null
      and i.due_date + v_grace < p_as_of
      and (v_service or public.can_access_district(i.district_id))
      and not exists (select 1 from public.payment_plan_invoices ppi join public.payment_plans pp on pp.id = ppi.plan_id
                      where ppi.invoice_id = i.id and pp.status in ('pending', 'active'))
    for update of i skip locked
  loop
    v_amount := round(r.balance * v_pct / 100, 2);
    if v_amount > 0 then
      update public.invoices set total = total + v_amount, penalty_applied_at = now() where id = r.id;
      insert into public.invoice_lines (invoice_id, kind, description, amount)
      values (r.id, 'penalty', 'Late payment penalty ' || v_pct || '%', v_amount);
      perform private.invoice_refresh_status(r.id);
      perform private.parcel_event(r.parcel_id, 'penalty_applied', null, jsonb_build_object('invoice_id', r.id, 'amount', v_amount));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment plans
-- ---------------------------------------------------------------------------
create or replace function public.payment_plan_request(p_parcel uuid, p_invoice_ids uuid[], p_instalments int, p_start date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_total numeric;
  v_n int;
  v_id uuid;
begin
  perform private.assert_permission('billing.update');
  select * into v_p from public.parcels where id = p_parcel;
  if v_p.id is null or not public.can_access_district(v_p.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if p_instalments is null or p_instalments < 2 or p_instalments > private.setting_int('billing.plan_max_instalments', 12) then
    perform private.raise_app_error('VALIDATION', 'instalments');
  end if;
  if p_start is null or p_start < current_date then
    perform private.raise_app_error('VALIDATION', 'start_date');
  end if;
  select count(*), coalesce(sum(balance), 0) into v_n, v_total from public.invoices
  where id = any (p_invoice_ids) and parcel_id = p_parcel and status in ('issued', 'partially_paid') and balance > 0;
  if v_n = 0 or v_n <> cardinality(p_invoice_ids) then
    perform private.raise_app_error('VALIDATION', 'invoices');
  end if;
  if exists (select 1 from public.payment_plan_invoices ppi join public.payment_plans pp on pp.id = ppi.plan_id
             where ppi.invoice_id = any (p_invoice_ids) and pp.status in ('pending', 'active')) then
    perform private.raise_app_error('CONFLICT', 'in_payment_plan');
  end if;
  insert into public.payment_plans (number, parcel_id, district_id, total, instalments, start_date, note, requested_by)
  values ('PP-' || extract(year from current_date)::int || '-' || lpad(private.next_serial('PP-' || extract(year from current_date)::int)::text, 5, '0'),
          p_parcel, v_p.district_id, v_total, p_instalments, p_start, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  insert into public.payment_plan_invoices (plan_id, invoice_id) select v_id, unnest(p_invoice_ids);
  -- Equal monthly instalments; the last one absorbs rounding.
  insert into public.payment_plan_installments (plan_id, seq, due_date, amount)
  select v_id, s, (p_start + make_interval(months => s - 1))::date,
         case when s < p_instalments then round(v_total / p_instalments, 2)
              else v_total - round(v_total / p_instalments, 2) * (p_instalments - 1) end
  from generate_series(1, p_instalments) s;
  perform private.parcel_event(p_parcel, 'payment_plan_requested', p_note, jsonb_build_object('plan_id', v_id, 'total', v_total));
  return v_id;
end;
$$;

create or replace function public.payment_plan_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_plans;
begin
  perform private.assert_permission('billing.approve');
  select * into v from public.payment_plans where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'plan');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.payment_plans
     set status = case when p_approve then 'active'::public.payment_plan_status else 'rejected'::public.payment_plan_status end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  perform private.parcel_event(v.parcel_id, case when p_approve then 'payment_plan_approved' else 'payment_plan_rejected' end, p_note);
end;
$$;

create or replace function public.payment_plan_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_plans;
begin
  perform private.assert_permission('billing.update');
  select * into v from public.payment_plans where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'plan');
  end if;
  if v.status not in ('pending', 'active') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.payment_plans set status = 'cancelled', decision_note = trim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform private.parcel_event(v.parcel_id, 'payment_plan_cancelled', p_reason);
end;
$$;

/** The secret link behind the invoice QR code (staff in the district or the owner). */
create or replace function public.invoice_pay_link(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '/pay/' || t.token from public.invoices i join public.invoice_tokens t on t.invoice_id = i.id
  where i.id = p_id and (private.can_view_invoice_district(i.district_id) or private.is_parcel_owner(i.parcel_id));
$$;

/** Public pay page: minimal, non-personal invoice data for a valid token. */
create or replace function public.invoice_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('number', i.number, 'pun', p.pun, 'period', i.period, 'fee', f.name_en, 'fee_so', f.name_so,
                            'due_date', i.due_date, 'total', i.total, 'paid', i.paid + i.credited, 'balance', i.balance,
                            'status', i.status, 'currency', i.currency)
  from public.invoice_tokens t join public.invoices i on i.id = t.invoice_id
  join public.parcels p on p.id = i.parcel_id join public.fee_types f on f.id = i.fee_type_id
  where t.token = p_token and length(p_token) = 64 and i.status <> 'cancelled';
$$;

create or replace function public.billing_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'runs_waiting', (select count(*) from public.billing_runs where status = 'submitted'),
    'invoices_open', (select count(*) from public.invoices where status in ('issued', 'partially_paid')),
    'invoices_overdue', (select count(*) from public.invoices where status in ('issued', 'partially_paid') and due_date < current_date),
    'outstanding', (select coalesce(sum(balance), 0) from public.invoices where status in ('issued', 'partially_paid')),
    'credit_notes_pending', (select count(*) from public.credit_notes where status = 'pending'),
    'plans_pending', (select count(*) from public.payment_plans where status = 'pending'));
$$;

-- Daily penalty sweep (no-op where pg_cron isn't installed, e.g. the test database).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('apply-late-penalties', '30 2 * * *', 'select public.apply_late_penalties()');
  end if;
end;
$$;

grant execute on function private.can_view_invoice_district(uuid) to authenticated;
revoke execute on function
  public.billing_run_create(jsonb), public.billing_run_refresh(uuid), public.billing_run_submit(uuid),
  public.billing_run_approve(uuid), public.billing_run_generate(uuid), public.billing_run_cancel(uuid, text),
  public.invoice_create(uuid, uuid, numeric, text, date), public.invoice_cancel(uuid, text),
  public.credit_note_request(uuid, numeric, text), public.credit_note_decide(uuid, boolean, text),
  public.apply_late_penalties(date), public.payment_plan_request(uuid, uuid[], int, date, text),
  public.payment_plan_decide(uuid, boolean, text), public.payment_plan_cancel(uuid, text),
  public.invoice_pay_link(uuid), public.billing_counts(), private.can_view_invoice_district(uuid)
from public, anon;
grant execute on function
  public.billing_run_create(jsonb), public.billing_run_refresh(uuid), public.billing_run_submit(uuid),
  public.billing_run_approve(uuid), public.billing_run_generate(uuid), public.billing_run_cancel(uuid, text),
  public.invoice_create(uuid, uuid, numeric, text, date), public.invoice_cancel(uuid, text),
  public.credit_note_request(uuid, numeric, text), public.credit_note_decide(uuid, boolean, text),
  public.apply_late_penalties(date), public.payment_plan_request(uuid, uuid[], int, date, text),
  public.payment_plan_decide(uuid, boolean, text), public.payment_plan_cancel(uuid, text),
  public.invoice_pay_link(uuid), public.billing_counts()
to authenticated;
grant execute on function public.apply_late_penalties(date) to service_role;
revoke execute on function public.invoice_by_token(text) from public;
grant execute on function public.invoice_by_token(text) to anon, authenticated;
revoke execute on function private.invoice_token_insert(), private.next_serial(text), private.invoice_number(int), private.invoice_refresh_status(uuid),
  private.invoice_apply_payment(uuid, numeric), private.billing_run_candidates(public.billing_runs),
  private.billing_run_preview(public.billing_runs), private.billing_run_scope(uuid)
from public, anon, authenticated;
