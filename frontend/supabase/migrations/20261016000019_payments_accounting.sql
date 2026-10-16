-- ============================================================================
-- 0019 Phase 7 — Payments, cashier shifts, webhooks, reversals, reconciliation and the
-- double-entry ledger (§4.8, §6, §8).
--
-- Money flow: invoice → (payment_intent → provider → webhook) or cashier → payment →
-- allocation (oldest invoice first, early discount, plan instalments, leftover = credit)
-- → balanced journal entry. Every financial event posts its own entry automatically:
--   invoice line   Dr 1200 Debtors            / Cr 41xx–43xx income   (contra lines: Dr 5100 / Cr 1200)
--   payment        Dr 11xx cash/clearing      / Cr 1200 Debtors (+ Cr 2100 customer credit)
--   reversal       the payment entry, mirrored
-- Amounts are posted in the base currency (USD); SOS payments convert at the day's rate.
-- ============================================================================

create type public.payment_method as enum ('cash', 'cheque', 'mobile_money', 'card', 'bank_transfer');
create type public.payment_status as enum ('completed', 'unmatched', 'reversed');
create type public.intent_status as enum ('pending', 'succeeded', 'failed', 'expired', 'cancelled');
create type public.shift_status as enum ('open', 'closed', 'approved');
create type public.gl_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.period_status as enum ('open', 'locked');
create type public.recon_status as enum ('matched', 'amount_mismatch', 'missing_in_system', 'missing_in_provider');

insert into public.settings (key, value, description) values
  ('payments.base_currency', '"USD"', 'Currency of invoices and the ledger'),
  ('payments.intent_ttl_minutes', '30', 'How long a payment intent stays open'),
  ('payments.max_shift_difference', '5', 'Cash difference (base currency) above which a shift needs a note')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Currencies and rates
-- ---------------------------------------------------------------------------
create table public.currencies (
  code      text primary key check (code ~ '^[A-Z]{3}$'),
  name_so   text not null,
  name_en   text not null,
  decimals  int not null default 2,
  active    boolean not null default true
);
insert into public.currencies (code, name_so, name_en, decimals) values
  ('USD', 'Doolarka Mareykanka', 'US dollar', 2),
  ('SOS', 'Shilinka Soomaaliga', 'Somali shilling', 0);

-- rate = units of the currency for 1 USD (e.g. SOS 571).
create table public.fx_rates (
  id          uuid primary key default gen_random_uuid(),
  currency    text not null references public.currencies (code),
  rate_date   date not null,
  rate        numeric(14, 6) not null check (rate > 0),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  unique (currency, rate_date)
);

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
create table public.gl_accounts (
  code     text primary key check (code ~ '^[0-9]{4}$'),
  name_so  text not null,
  name_en  text not null,
  type     public.gl_type not null,
  active   boolean not null default true
);
insert into public.gl_accounts (code, name_so, name_en, type) values
  ('1100', 'Lacag caddaan ah', 'Cash on hand', 'asset'),
  ('1110', 'Lacagaha mobilka (hubin)', 'Mobile money clearing', 'asset'),
  ('1120', 'Kaararka (hubin)', 'Card clearing', 'asset'),
  ('1130', 'Bangiga', 'Bank', 'asset'),
  ('1200', 'Deymaha (dadka lagu leeyahay)', 'Debtors (receivables)', 'asset'),
  ('2100', 'Lacagta macaamiisha ka hartay', 'Customer credit (overpayments)', 'liability'),
  ('3100', 'Hantida guud', 'Accumulated surplus', 'equity'),
  ('4100', 'Dakhliga canshuurta hantida', 'Property tax income', 'income'),
  ('4110', 'Dakhliga khidmadda adeegga', 'Service charge income', 'income'),
  ('4200', 'Dakhliga khidmadaha', 'Fee income', 'income'),
  ('4300', 'Dakhliga ganaaxa', 'Penalty income', 'income'),
  ('5100', 'Dhimisyada iyo warqadaha dhimista', 'Discounts and credit notes', 'expense'),
  ('5200', 'Kharashyada kale', 'Other expenses', 'expense');

create table public.fiscal_periods (
  year       int not null,
  month      int not null check (month between 1 and 12),
  status     public.period_status not null default 'open',
  locked_by  uuid references auth.users (id) on delete set null,
  locked_at  timestamptz,
  primary key (year, month)
);

create table public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  entry_date  date not null,
  source      text not null check (source in ('invoice', 'invoice_cancel', 'payment', 'reversal', 'manual')),
  source_id   uuid,
  memo        text not null,
  total       numeric(16, 2) not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);
create index journal_entries_date_idx on public.journal_entries (entry_date);
create index journal_entries_source_idx on public.journal_entries (source, source_id);

create table public.journal_lines (
  id           bigint generated always as identity primary key,
  entry_id     uuid not null references public.journal_entries (id),
  account      text not null references public.gl_accounts (code),
  district_id  uuid references public.districts (id),
  debit        numeric(16, 2) not null default 0 check (debit >= 0),
  credit       numeric(16, 2) not null default 0 check (credit >= 0),
  check ((debit > 0) <> (credit > 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account);

/**
 * Post one balanced entry. p_lines = [{account, debit, credit, district_id}]. Zero lines are dropped.
 * Fails if debits ≠ credits or the month is locked.
 */
create or replace function private.post_journal(p_date date, p_source text, p_source_id uuid, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_dr numeric;
  v_cr numeric;
begin
  if exists (select 1 from public.fiscal_periods where year = extract(year from p_date)::int and month = extract(month from p_date)::int and status = 'locked') then
    perform private.raise_app_error('CONFLICT', 'period_locked');
  end if;
  select coalesce(sum(round(coalesce((l ->> 'debit')::numeric, 0), 2)), 0), coalesce(sum(round(coalesce((l ->> 'credit')::numeric, 0), 2)), 0)
    into v_dr, v_cr from jsonb_array_elements(p_lines) l;
  if v_dr <> v_cr then
    raise exception 'unbalanced journal: debit % credit %', v_dr, v_cr;
  end if;
  if v_dr = 0 then
    return null;
  end if;
  insert into public.journal_entries (number, entry_date, source, source_id, memo, total, created_by)
  values ('JE-' || extract(year from p_date)::int || '-' || lpad(private.next_serial('JE-' || extract(year from p_date)::int)::text, 7, '0'),
          p_date, p_source, p_source_id, p_memo, v_dr, auth.uid())
  returning id into v_id;
  insert into public.journal_lines (entry_id, account, district_id, debit, credit)
  select v_id, l ->> 'account', nullif(l ->> 'district_id', '')::uuid,
         round(coalesce((l ->> 'debit')::numeric, 0), 2), round(coalesce((l ->> 'credit')::numeric, 0), 2)
  from jsonb_array_elements(p_lines) l
  where round(coalesce((l ->> 'debit')::numeric, 0), 2) > 0 or round(coalesce((l ->> 'credit')::numeric, 0), 2) > 0;
  return v_id;
end;
$$;

create or replace function private.line_income_account(p_kind public.invoice_line_kind)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'tax' then '4100' when 'service' then '4110' when 'fee' then '4200' when 'penalty' then '4300' else '5100' end;
$$;

/** Every invoice line posts: charges Dr Debtors / Cr income; contra lines (credit notes, discounts) Dr 5100 / Cr Debtors. */
create or replace function private.invoice_line_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = new.invoice_id;
  if new.amount > 0 then
    perform private.post_journal(current_date, 'invoice', new.invoice_id, v_inv.number || ' — ' || new.description,
      jsonb_build_array(jsonb_build_object('account', '1200', 'debit', new.amount, 'district_id', v_inv.district_id),
                        jsonb_build_object('account', private.line_income_account(new.kind), 'credit', new.amount, 'district_id', v_inv.district_id)));
  elsif new.amount < 0 then
    perform private.post_journal(current_date, 'invoice', new.invoice_id, v_inv.number || ' — ' || new.description,
      jsonb_build_array(jsonb_build_object('account', '5100', 'debit', -new.amount, 'district_id', v_inv.district_id),
                        jsonb_build_object('account', '1200', 'credit', -new.amount, 'district_id', v_inv.district_id)));
  end if;
  return new;
end;
$$;
create trigger post_journal after insert on public.invoice_lines for each row execute function private.invoice_line_post();

/** A cancelled invoice reverses what is still owed on it. */
create or replace function private.invoice_cancel_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open numeric := old.total - old.paid - old.credited;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and v_open > 0 then
    perform private.post_journal(current_date, 'invoice_cancel', new.id, new.number || ' cancelled',
      jsonb_build_array(jsonb_build_object('account', '5100', 'debit', v_open, 'district_id', new.district_id),
                        jsonb_build_object('account', '1200', 'credit', v_open, 'district_id', new.district_id)));
  end if;
  return new;
end;
$$;
create trigger post_cancel after update of status on public.invoices for each row execute function private.invoice_cancel_post();

-- ---------------------------------------------------------------------------
-- Points of sale, providers, shifts
-- ---------------------------------------------------------------------------
create table public.points_of_sale (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9]{2,12}$'),
  name            text not null,
  district_id     uuid references public.districts (id),
  kind            text not null default 'cashier' check (kind in ('cashier', 'field', 'online')),
  receipt_prefix  text not null check (receipt_prefix ~ '^[A-Z0-9-]{2,16}$'),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
insert into public.points_of_sale (code, name, kind, receipt_prefix) values ('ONLINE', 'Online payments', 'online', 'ONL');
alter table public.profiles add constraint profiles_point_of_sale_fk foreign key (point_of_sale_id) references public.points_of_sale (id);

create table public.payment_providers (
  code     text primary key,
  name     text not null,
  method   public.payment_method not null,
  enabled  boolean not null default false,
  sort     int not null default 0
);
insert into public.payment_providers (code, name, method, enabled, sort) values
  ('waafipay', 'WaafiPay (EVC Plus, Zaad, Sahal, eDahab)', 'mobile_money', false, 10),
  ('stripe', 'Card (Stripe)', 'card', false, 20),
  ('bank', 'Bank transfer', 'bank_transfer', true, 30),
  ('cash', 'Cash / cheque at a cashier', 'cash', true, 40),
  ('test', 'Test provider (development only)', 'mobile_money', false, 99);

create table public.cashier_shifts (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  pos_id          uuid not null references public.points_of_sale (id),
  cashier_id      uuid not null references auth.users (id),
  district_id     uuid references public.districts (id),
  opened_at       timestamptz not null default now(),
  opening_float   numeric(14, 2) not null default 0 check (opening_float >= 0),
  closed_at       timestamptz,
  expected_cash   numeric(14, 2),
  counted_cash    numeric(14, 2),
  difference      numeric(14, 2),
  status          public.shift_status not null default 'open',
  close_note      text,
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz
);
-- One open shift per cashier.
create unique index cashier_shifts_open_uidx on public.cashier_shifts (cashier_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Intents, payments, allocations, webhooks, reversals
-- ---------------------------------------------------------------------------
create table public.payment_intents (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices (id),
  provider         text not null references public.payment_providers (code),
  amount           numeric(14, 2) not null check (amount > 0),
  currency         text not null references public.currencies (code),
  status           public.intent_status not null default 'pending',
  phone            text,
  provider_ref     text unique,
  checkout_url     text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  expires_at       timestamptz not null,
  completed_at     timestamptz,
  failure_reason   text
);
create index payment_intents_invoice_idx on public.payment_intents (invoice_id, created_at desc);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  receipt_no       text not null unique,
  parcel_id        uuid references public.parcels (id),
  district_id      uuid references public.districts (id),
  method           public.payment_method not null,
  provider         text references public.payment_providers (code),
  provider_ref     text unique,
  reference        text,
  currency         text not null references public.currencies (code),
  fx_rate          numeric(14, 6) not null default 1,
  amount           numeric(14, 2) not null check (amount > 0),
  amount_base      numeric(14, 2) not null check (amount_base > 0),
  unallocated      numeric(14, 2) not null default 0 check (unallocated >= 0),
  status           public.payment_status not null default 'completed',
  received_at      timestamptz not null default now(),
  pos_id           uuid references public.points_of_sale (id),
  shift_id         uuid references public.cashier_shifts (id),
  intent_id        uuid references public.payment_intents (id),
  payer_name       text,
  payer_phone      text,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  reversed_at      timestamptz,
  reversed_by      uuid references auth.users (id) on delete set null,
  reversal_reason  text,
  check ((status = 'unmatched') = (parcel_id is null) or status = 'reversed')
);
create index payments_parcel_idx on public.payments (parcel_id);
create index payments_shift_idx on public.payments (shift_id);
create index payments_received_idx on public.payments (received_at desc);

create table public.payment_allocations (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references public.payments (id),
  invoice_id  uuid not null references public.invoices (id),
  amount      numeric(14, 2) not null check (amount > 0),
  discount    numeric(14, 2) not null default 0 check (discount >= 0),
  created_at  timestamptz not null default now()
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

create table public.provider_webhook_events (
  id            bigint generated always as identity primary key,
  provider      text not null,
  event_id      text not null,
  raw           jsonb not null,
  signature_ok  boolean not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  result        text,
  payment_id    uuid references public.payments (id),
  unique (provider, event_id)
);

create table public.payment_reversals (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.payments (id),
  reason         text not null check (length(trim(reason)) >= 5),
  status         public.decision_status not null default 'pending',
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text
);
create unique index payment_reversals_pending_uidx on public.payment_reversals (payment_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
create table public.reconciliation_batches (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  provider    text not null references public.payment_providers (code),
  date_from   date not null,
  date_to     date not null,
  summary     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  check (date_to >= date_from)
);

create table public.reconciliation_lines (
  id            bigint generated always as identity primary key,
  batch_id      uuid not null references public.reconciliation_batches (id) on delete cascade,
  provider_ref  text,
  amount        numeric(14, 2),
  line_date     date,
  status        public.recon_status not null,
  payment_id    uuid references public.payments (id),
  system_amount numeric(14, 2)
);
create index reconciliation_lines_batch_idx on public.reconciliation_lines (batch_id, status);

create trigger audit after insert or update or delete on public.payments for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.cashier_shifts for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.payment_reversals for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.fx_rates for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.fiscal_periods for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.points_of_sale for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.payment_providers for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create or replace function private.can_view_payment(p_district uuid, p_parcel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_district is null and public.has_permission('payments.approve'))
      or ((public.has_permission('payments.view') or public.has_permission('cashier.view')) and p_district is not null and public.can_access_district(p_district))
      or (p_parcel is not null and private.is_parcel_owner(p_parcel));
$$;

do $$
declare t text;
begin
  foreach t in array array['currencies', 'fx_rates', 'gl_accounts', 'fiscal_periods', 'journal_entries', 'journal_lines', 'points_of_sale',
                           'payment_providers', 'cashier_shifts', 'payment_intents', 'payments', 'payment_allocations',
                           'provider_webhook_events', 'payment_reversals', 'reconciliation_batches', 'reconciliation_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end;
$$;
revoke select on public.provider_webhook_events from authenticated;

create policy currencies_select on public.currencies for select to authenticated using (true);
create policy fx_rates_select on public.fx_rates for select to authenticated using (true);
create policy gl_accounts_select on public.gl_accounts for select to authenticated using (true);
create policy fiscal_periods_select on public.fiscal_periods for select to authenticated using (true);
create policy points_of_sale_select on public.points_of_sale for select to authenticated using (true);
create policy payment_providers_select on public.payment_providers for select to authenticated using (true);
create policy journal_entries_select on public.journal_entries for select to authenticated using (public.has_permission('accounting.view'));
create policy journal_lines_select on public.journal_lines for select to authenticated using (public.has_permission('accounting.view'));
create policy cashier_shifts_select on public.cashier_shifts for select to authenticated
  using (cashier_id = (select auth.uid()) or (public.has_permission('payments.approve') and (district_id is null or public.can_access_district(district_id))));
create policy payment_intents_select on public.payment_intents for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (private.can_view_invoice_district(i.district_id) or private.is_parcel_owner(i.parcel_id))));
create policy payments_select on public.payments for select to authenticated using (private.can_view_payment(district_id, parcel_id));
create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and private.can_view_payment(p.district_id, p.parcel_id)));
create policy payment_reversals_select on public.payment_reversals for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and private.can_view_payment(p.district_id, p.parcel_id)));
create policy reconciliation_batches_select on public.reconciliation_batches for select to authenticated using (public.has_permission('reconciliation.view'));
create policy reconciliation_lines_select on public.reconciliation_lines for select to authenticated using (public.has_permission('reconciliation.view'));

-- ---------------------------------------------------------------------------
-- Core: convert, allocate, record
-- ---------------------------------------------------------------------------
create or replace function private.fx_rate_for(p_currency text, p_on date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_currency = 'USD' then
    return 1;
  end if;
  select rate into v from public.fx_rates where currency = p_currency and rate_date <= p_on order by rate_date desc limit 1;
  if v is null then
    perform private.raise_app_error('CONFLICT', 'no_fx_rate');
  end if;
  return v;
end;
$$;

create or replace function private.clearing_account(p_method public.payment_method)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_method when 'cash' then '1100' when 'cheque' then '1100' when 'mobile_money' then '1110' when 'card' then '1120' else '1130' end;
$$;

/** Spread money over a plan's unpaid instalments, oldest first; complete the plan when everything is paid. */
create or replace function private.plan_apply(p_invoice uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left numeric := p_amount;
  r record;
  v_take numeric;
begin
  for r in select pi.id, pi.plan_id, pi.amount - pi.paid as open from public.payment_plan_installments pi
           join public.payment_plan_invoices ppi on ppi.plan_id = pi.plan_id
           join public.payment_plans pp on pp.id = pi.plan_id
           where ppi.invoice_id = p_invoice and pp.status = 'active' and pi.paid < pi.amount
           order by pi.due_date, pi.seq for update of pi loop
    exit when v_left <= 0;
    v_take := least(v_left, r.open);
    update public.payment_plan_installments set paid = paid + v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  update public.payment_plans pp set status = 'completed'
   where pp.status = 'active' and pp.id in (select plan_id from public.payment_plan_invoices where invoice_id = p_invoice)
     and not exists (select 1 from public.payment_plan_installments pi where pi.plan_id = pp.id and pi.paid < pi.amount);
end;
$$;

/**
 * Allocate a payment (base currency) to a parcel's open invoices: the chosen invoice first if given, then
 * oldest due first. The early-payment discount applies when the money settles the whole balance inside the
 * window. Returns {allocated, discount, leftover}.
 */
create or replace function private.allocate_payment(p_payment uuid, p_invoice uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
  v_left numeric;
  r record;
  v_disc numeric;
  v_take numeric;
  v_alloc numeric := 0;
  v_disc_total numeric := 0;
  v_on date;
begin
  select * into v_p from public.payments where id = p_payment for update;
  v_left := v_p.unallocated;
  v_on := v_p.received_at::date;
  for r in select i.* from public.invoices i
           where i.parcel_id = v_p.parcel_id and i.status in ('issued', 'partially_paid') and i.balance > 0
           order by (i.id = p_invoice) desc, i.due_date, i.issue_date, i.number for update loop
    exit when v_left <= 0;
    v_disc := 0;
    if r.discount_until is not null and r.discount_until >= v_on and r.paid = 0 and r.early_discount_pct > 0 then
      v_disc := round(r.balance * r.early_discount_pct / 100, 2);
      if v_left < r.balance - v_disc then
        v_disc := 0; -- the discount needs the full (discounted) balance
      end if;
    end if;
    if v_disc > 0 then
      insert into public.invoice_lines (invoice_id, kind, description, amount)
      values (r.id, 'credit', 'Early payment discount ' || r.early_discount_pct || '%', -v_disc);
      update public.invoices set credited = credited + v_disc where id = r.id;
    end if;
    v_take := least(v_left, r.balance - v_disc);
    if v_take > 0 then
      perform private.invoice_apply_payment(r.id, v_take);
      perform private.plan_apply(r.id, v_take);
      insert into public.payment_allocations (payment_id, invoice_id, amount, discount) values (p_payment, r.id, v_take, v_disc);
      v_left := v_left - v_take;
      v_alloc := v_alloc + v_take;
    end if;
    perform private.invoice_refresh_status(r.id);
    v_disc_total := v_disc_total + v_disc;
  end loop;
  update public.payments set unallocated = v_left where id = p_payment;
  return jsonb_build_object('allocated', v_alloc, 'discount', v_disc_total, 'leftover', v_left);
end;
$$;

/**
 * Record money received. p: {parcel_id?, invoice_id?, method, provider?, provider_ref?, reference?, currency, amount,
 * received_at?, pos_id?, shift_id?, intent_id?, payer_name?, payer_phone?, note?}. With no parcel the payment is
 * unmatched and waits in the matching queue. Posts the journal and queues the receipt SMS.
 */
create or replace function private.record_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcel public.parcels;
  v_currency text := coalesce(nullif(p ->> 'currency', ''), 'USD');
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_received timestamptz := coalesce(nullif(p ->> 'received_at', '')::timestamptz, now());
  v_rate numeric;
  v_base numeric;
  v_pos public.points_of_sale;
  v_receipt text;
  v_id uuid;
  v_alloc jsonb := jsonb_build_object('allocated', 0, 'discount', 0, 'leftover', 0);
  v_method public.payment_method := (p ->> 'method')::public.payment_method;
  v_lines jsonb;
begin
  if v_amount is null or v_amount <= 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if nullif(p ->> 'parcel_id', '') is not null then
    select * into v_parcel from public.parcels where id = (p ->> 'parcel_id')::uuid and deleted_at is null;
    if v_parcel.id is null then
      perform private.raise_app_error('NOT_FOUND', 'parcel');
    end if;
  end if;
  v_rate := private.fx_rate_for(v_currency, v_received::date);
  v_base := round(v_amount / v_rate, 2);
  select * into v_pos from public.points_of_sale where id = coalesce(nullif(p ->> 'pos_id', '')::uuid, (select id from public.points_of_sale where code = 'ONLINE'));
  v_receipt := v_pos.receipt_prefix || '-' || extract(year from v_received)::int || '-' || lpad(private.next_serial('RCP-' || v_pos.code || '-' || extract(year from v_received)::int)::text, 6, '0');

  insert into public.payments (receipt_no, parcel_id, district_id, method, provider, provider_ref, reference, currency, fx_rate, amount, amount_base,
                               unallocated, status, received_at, pos_id, shift_id, intent_id, payer_name, payer_phone, note, created_by)
  values (v_receipt, v_parcel.id, v_parcel.district_id, v_method, nullif(p ->> 'provider', ''), nullif(p ->> 'provider_ref', ''), nullif(trim(p ->> 'reference'), ''),
          v_currency, v_rate, v_amount, v_base, v_base, case when v_parcel.id is null then 'unmatched'::public.payment_status else 'completed'::public.payment_status end,
          v_received, v_pos.id, nullif(p ->> 'shift_id', '')::uuid, nullif(p ->> 'intent_id', '')::uuid, nullif(trim(p ->> 'payer_name'), ''),
          nullif(trim(p ->> 'payer_phone'), ''), nullif(trim(p ->> 'note'), ''), auth.uid())
  returning id into v_id;

  if v_parcel.id is not null then
    v_alloc := private.allocate_payment(v_id, nullif(p ->> 'invoice_id', '')::uuid);
  end if;
  -- Dr cash/clearing; Cr debtors for what was allocated, Cr customer credit for the rest (all of it when unmatched).
  v_lines := jsonb_build_array(
    jsonb_build_object('account', private.clearing_account(v_method), 'debit', v_base, 'district_id', v_parcel.district_id),
    jsonb_build_object('account', '1200', 'credit', (v_alloc ->> 'allocated')::numeric, 'district_id', v_parcel.district_id),
    jsonb_build_object('account', '2100', 'credit', v_base - (v_alloc ->> 'allocated')::numeric, 'district_id', v_parcel.district_id));
  perform private.post_journal(v_received::date, 'payment', v_id, 'Receipt ' || v_receipt, v_lines);
  if v_parcel.id is not null then
    perform private.parcel_event(v_parcel.id, 'payment', null, jsonb_build_object('payment_id', v_id, 'receipt', v_receipt, 'amount', v_base));
  end if;
  insert into public.jobs (kind, payload, created_by) values ('sms.receipt', jsonb_build_object('payment_id', v_id), auth.uid());
  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_receipt, 'amount_base', v_base) || v_alloc;
end;
$$;

/** Undo a payment: give the money back to the invoices it paid, mirror its journal, mark it reversed. */
create or replace function private.reverse_payment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  a record;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into v from public.payments where id = p_id for update;
  if v.status = 'reversed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  for a in select * from public.payment_allocations where payment_id = p_id loop
    update public.invoices set paid = greatest(paid - a.amount, 0) where id = a.invoice_id;
    perform private.invoice_refresh_status(a.invoice_id);
    update public.payment_plan_installments pi set paid = greatest(pi.paid - a.amount, 0)
     where pi.id = (select pi2.id from public.payment_plan_installments pi2 join public.payment_plan_invoices ppi on ppi.plan_id = pi2.plan_id
                    where ppi.invoice_id = a.invoice_id and pi2.paid > 0 order by pi2.due_date desc limit 1);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('account', l.account, 'debit', l.credit, 'credit', l.debit, 'district_id', l.district_id)), '[]'::jsonb)
    into v_lines
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
  where e.source = 'payment' and e.source_id = p_id;
  perform private.post_journal(current_date, 'reversal', p_id, 'Reversal of ' || v.receipt_no || ': ' || p_reason, v_lines);
  update public.payments set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason, unallocated = 0 where id = p_id;
  if v.parcel_id is not null then
    perform private.parcel_event(v.parcel_id, 'payment_reversed', p_reason, jsonb_build_object('payment_id', p_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashier
-- ---------------------------------------------------------------------------
create or replace function public.shift_open(p_pos uuid, p_float numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos public.points_of_sale;
  v_id uuid;
begin
  perform private.assert_permission('cashier.create');
  select * into v_pos from public.points_of_sale where id = p_pos and active and kind <> 'online';
  if v_pos.id is null or (v_pos.district_id is not null and not public.can_access_district(v_pos.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'point_of_sale');
  end if;
  insert into public.cashier_shifts (number, pos_id, cashier_id, district_id, opening_float)
  values ('SH-' || v_pos.code || '-' || lpad(private.next_serial('SH-' || v_pos.code)::text, 5, '0'), p_pos, auth.uid(), v_pos.district_id, round(coalesce(p_float, 0), 2))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'shift_open');
end;
$$;

/** Cashier takes a payment in their open shift. p: {parcel_id, invoice_id?, amount, currency, method, payer_name, payer_phone, reference, note}. */
create or replace function public.cashier_take_payment(p_shift uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.cashier_shifts;
  v_parcel public.parcels;
  v_method text := coalesce(p ->> 'method', 'cash');
begin
  perform private.assert_permission('payments.create');
  select * into v_s from public.cashier_shifts where id = p_shift for update;
  if v_s.id is null or v_s.cashier_id <> auth.uid() or v_s.status <> 'open' then
    perform private.raise_app_error('CONFLICT', 'shift_not_open');
  end if;
  if v_method not in ('cash', 'cheque', 'bank_transfer') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  select * into v_parcel from public.parcels where id = nullif(p ->> 'parcel_id', '')::uuid and deleted_at is null;
  if v_parcel.id is null or not public.can_access_district(v_parcel.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return private.record_payment(p || jsonb_build_object('method', v_method, 'provider', case when v_method = 'bank_transfer' then 'bank' else 'cash' end,
                                                        'pos_id', v_s.pos_id, 'shift_id', v_s.id));
end;
$$;

/** Close: expected = float + cash taken in the shift (base currency); a large difference needs a note. */
create or replace function public.shift_close(p_id uuid, p_counted numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_shifts;
  v_expected numeric;
begin
  perform private.assert_permission('cashier.update');
  select * into v from public.cashier_shifts where id = p_id for update;
  if v.id is null or v.cashier_id <> auth.uid() or v.status <> 'open' then
    perform private.raise_app_error('CONFLICT', 'shift_not_open');
  end if;
  if p_counted is null or p_counted < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  select v.opening_float + coalesce(sum(amount_base), 0) into v_expected
  from public.payments where shift_id = p_id and method = 'cash' and status <> 'reversed';
  if abs(round(p_counted, 2) - v_expected) > private.setting_numeric('payments.max_shift_difference', 5) and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.cashier_shifts
     set status = 'closed', closed_at = now(), expected_cash = v_expected, counted_cash = round(p_counted, 2),
         difference = round(p_counted, 2) - v_expected, close_note = nullif(trim(p_note), '')
   where id = p_id;
  return jsonb_build_object('expected', v_expected, 'counted', round(p_counted, 2), 'difference', round(p_counted, 2) - v_expected);
end;
$$;

create or replace function public.shift_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_shifts;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.cashier_shifts where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'shift');
  end if;
  if v.status <> 'closed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.cashier_id);
  update public.cashier_shifts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Online payments: intents and webhooks
-- ---------------------------------------------------------------------------
/** Start an online payment for an invoice (owner, staff, or anyone holding the invoice QR token). */
create or replace function public.payment_intent_create(p_invoice uuid, p_token text, p_provider text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_prov public.payment_providers;
  v_id uuid;
  v_amount numeric;
begin
  if p_token is not null then
    select i.* into v_inv from public.invoice_tokens t join public.invoices i on i.id = t.invoice_id where t.token = p_token;
  else
    select * into v_inv from public.invoices where id = p_invoice
      and (private.is_parcel_owner(parcel_id) or (public.has_permission('payments.create') and public.can_access_district(district_id)));
  end if;
  if v_inv.id is null or v_inv.status not in ('issued', 'partially_paid') or v_inv.balance <= 0 then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  select * into v_prov from public.payment_providers where code = p_provider and enabled and method in ('mobile_money', 'card');
  if v_prov.code is null then
    perform private.raise_app_error('VALIDATION', 'provider');
  end if;
  if v_prov.method = 'mobile_money' and coalesce(p_phone, '') !~ '^\+?252[0-9]{8,9}$' then
    perform private.raise_app_error('VALIDATION', 'phone');
  end if;
  if (select count(*) from public.payment_intents where invoice_id = v_inv.id and created_at > now() - interval '10 minutes') >= 5 then
    perform private.raise_app_error('RATE_LIMITED');
  end if;
  -- Pay the discounted balance if the early-payment window is open.
  v_amount := v_inv.balance;
  if v_inv.discount_until is not null and v_inv.discount_until >= current_date and v_inv.paid = 0 and v_inv.early_discount_pct > 0 then
    v_amount := v_inv.balance - round(v_inv.balance * v_inv.early_discount_pct / 100, 2);
  end if;
  insert into public.payment_intents (invoice_id, provider, amount, currency, phone, created_by, expires_at)
  values (v_inv.id, p_provider, v_amount, v_inv.currency, nullif(p_phone, ''), auth.uid(),
          now() + make_interval(mins => private.setting_int('payments.intent_ttl_minutes', 30)))
  returning id into v_id;
  return jsonb_build_object('intent_id', v_id, 'amount', v_amount, 'currency', v_inv.currency, 'invoice_number', v_inv.number,
                            'pun', (select pun from public.parcels where id = v_inv.parcel_id));
end;
$$;

/** Server-side after the provider accepted the checkout (service role only). */
create or replace function public.payment_intent_set_checkout(p_id uuid, p_provider_ref text, p_checkout_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_intents set provider_ref = nullif(p_provider_ref, ''), checkout_url = nullif(p_checkout_url, '')
   where id = p_id and status = 'pending';
$$;

/** Status for the pay page to poll (by intent id; reveals nothing personal). */
create or replace function public.payment_intent_status(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', case when pi.status = 'pending' and pi.expires_at < now() then 'expired' else pi.status::text end,
                            'receipt_no', (select receipt_no from public.payments where intent_id = pi.id limit 1),
                            'failure_reason', pi.failure_reason)
  from public.payment_intents pi where pi.id = p_id;
$$;

/**
 * Ingest a provider webhook (service role only). Idempotent on (provider, event_id).
 * p_event: {status: succeeded|failed, provider_ref?, intent_id?, amount, currency, reference?, phone?, failure_reason?}
 * Signature failures are stored and ignored. Money with no intent is matched by PUN reference, else unmatched.
 */
create or replace function public.webhook_ingest(p_provider text, p_event_id text, p_signature_ok boolean, p_event jsonb, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev bigint;
  v_intent public.payment_intents;
  v_inv public.invoices;
  v_parcel uuid;
  v_res jsonb;
  v_result text;
  v_method public.payment_method;
begin
  insert into public.provider_webhook_events (provider, event_id, raw, signature_ok)
  values (p_provider, p_event_id, coalesce(p_raw, '{}'::jsonb), p_signature_ok)
  on conflict (provider, event_id) do nothing
  returning id into v_ev;
  if v_ev is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if not p_signature_ok then
    update public.provider_webhook_events set processed_at = now(), result = 'bad_signature' where id = v_ev;
    return jsonb_build_object('result', 'bad_signature');
  end if;
  select method into v_method from public.payment_providers where code = p_provider;

  select * into v_intent from public.payment_intents
  where id = nullif(p_event ->> 'intent_id', '')::uuid or (provider_ref is not null and provider_ref = p_event ->> 'provider_ref')
  limit 1 for update;

  if p_event ->> 'status' <> 'succeeded' then
    if v_intent.id is not null and v_intent.status = 'pending' then
      update public.payment_intents set status = 'failed', failure_reason = left(coalesce(p_event ->> 'failure_reason', 'failed'), 200), completed_at = now()
       where id = v_intent.id;
    end if;
    update public.provider_webhook_events set processed_at = now(), result = 'failed' where id = v_ev;
    return jsonb_build_object('result', 'failed');
  end if;

  if exists (select 1 from public.payments where provider_ref = coalesce(p_event ->> 'provider_ref', p_event_id)) then
    update public.provider_webhook_events set processed_at = now(), result = 'already_recorded' where id = v_ev;
    return jsonb_build_object('result', 'already_recorded');
  end if;

  if v_intent.id is not null then
    select * into v_inv from public.invoices where id = v_intent.invoice_id;
    v_parcel := v_inv.parcel_id;
    v_result := 'recorded';
  else
    -- Merchant-number / USSD payments carry the PUN as the reference.
    select id into v_parcel from public.parcels where pun = upper(trim(p_event ->> 'reference')) and deleted_at is null;
    v_result := case when v_parcel is null then 'unmatched' else 'recorded_by_reference' end;
  end if;

  v_res := private.record_payment(jsonb_build_object(
    'parcel_id', v_parcel, 'invoice_id', v_inv.id, 'method', coalesce(v_method, 'mobile_money'), 'provider', p_provider,
    'provider_ref', coalesce(p_event ->> 'provider_ref', p_event_id), 'reference', p_event ->> 'reference',
    'currency', coalesce(p_event ->> 'currency', 'USD'), 'amount', (p_event ->> 'amount')::numeric,
    'intent_id', v_intent.id, 'payer_phone', p_event ->> 'phone'));
  if v_intent.id is not null then
    update public.payment_intents set status = 'succeeded', completed_at = now() where id = v_intent.id;
  end if;
  update public.provider_webhook_events set processed_at = now(), result = v_result, payment_id = (v_res ->> 'payment_id')::uuid where id = v_ev;
  return jsonb_build_object('result', v_result) || v_res;
end;
$$;

/** Staff record a bank transfer or other money received outside a shift (e.g. from a bank statement). */
create or replace function public.payment_record_manual(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcel public.parcels;
begin
  perform private.assert_permission('payments.approve');
  if (p ->> 'method') not in ('bank_transfer', 'cheque') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  if nullif(p ->> 'parcel_id', '') is not null then
    select * into v_parcel from public.parcels where id = (p ->> 'parcel_id')::uuid;
    if v_parcel.id is null or not public.can_access_district(v_parcel.district_id) then
      perform private.raise_app_error('NOT_FOUND', 'parcel');
    end if;
  end if;
  return private.record_payment(p || jsonb_build_object('provider', 'bank', 'pos_id', null, 'shift_id', null));
end;
$$;

/** Match an unmatched payment to a parcel and allocate it. */
create or replace function public.payment_match(p_id uuid, p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_parcel public.parcels;
  v_alloc jsonb;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.payments where id = p_id for update;
  if v.id is null or v.status <> 'unmatched' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  select * into v_parcel from public.parcels where id = p_parcel and deleted_at is null;
  if v_parcel.id is null or not public.can_access_district(v_parcel.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  update public.payments set parcel_id = p_parcel, district_id = v_parcel.district_id, status = 'completed' where id = p_id;
  v_alloc := private.allocate_payment(p_id, null);
  -- Move what was allocated from customer credit to debtors.
  perform private.post_journal(current_date, 'payment', p_id, 'Matched ' || v.receipt_no || ' to ' || coalesce(v_parcel.pun, ''),
    jsonb_build_array(jsonb_build_object('account', '2100', 'debit', (v_alloc ->> 'allocated')::numeric, 'district_id', v_parcel.district_id),
                      jsonb_build_object('account', '1200', 'credit', (v_alloc ->> 'allocated')::numeric, 'district_id', v_parcel.district_id)));
  perform private.parcel_event(p_parcel, 'payment', 'matched', jsonb_build_object('payment_id', p_id, 'receipt', v.receipt_no));
  return v_alloc;
end;
$$;

/** Apply a parcel's leftover credit (overpayments) to its open invoices. */
create or replace function public.payment_apply_credit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_alloc jsonb;
begin
  perform private.assert_permission('payments.create');
  select * into v from public.payments where id = p_id for update;
  if v.id is null or v.status <> 'completed' or v.unallocated <= 0 or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('CONFLICT', 'nothing_to_apply');
  end if;
  v_alloc := private.allocate_payment(p_id, null);
  perform private.post_journal(current_date, 'payment', p_id, 'Credit applied from ' || v.receipt_no,
    jsonb_build_array(jsonb_build_object('account', '2100', 'debit', (v_alloc ->> 'allocated')::numeric, 'district_id', v.district_id),
                      jsonb_build_object('account', '1200', 'credit', (v_alloc ->> 'allocated')::numeric, 'district_id', v.district_id)));
  return v_alloc;
end;
$$;

create or replace function public.reversal_request(p_payment uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_id uuid;
begin
  perform private.assert_permission('payments.refund');
  select * into v from public.payments where id = p_payment;
  if v.id is null or not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'payment');
  end if;
  if v.status = 'reversed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  insert into public.payment_reversals (payment_id, reason, requested_by) values (p_payment, trim(p_reason), auth.uid()) returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'reversal_pending');
end;
$$;

create or replace function public.reversal_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_reversals;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.payment_reversals where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'reversal');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.payment_reversals
     set status = case when p_approve then 'approved'::public.decision_status else 'rejected'::public.decision_status end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_approve then
    perform private.reverse_payment(v.payment_id, v.reason);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation and accounting administration
-- ---------------------------------------------------------------------------
/** Compare a provider settlement report with recorded payments. p_rows: [{provider_ref, amount, date}]. */
create or replace function public.reconciliation_run(p_provider text, p_from date, p_to date, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_summary jsonb;
begin
  perform private.assert_permission('reconciliation.create');
  if not exists (select 1 from public.payment_providers where code = p_provider) then
    perform private.raise_app_error('VALIDATION', 'provider');
  end if;
  if p_to < p_from or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    perform private.raise_app_error('VALIDATION', 'rows');
  end if;
  insert into public.reconciliation_batches (number, provider, date_from, date_to, created_by)
  values ('REC-' || lpad(private.next_serial('REC')::text, 5, '0'), p_provider, p_from, p_to, auth.uid())
  returning id into v_id;

  with report as (
    select trim(r ->> 'provider_ref') as ref, round((r ->> 'amount')::numeric, 2) as amount, nullif(r ->> 'date', '')::date as d
    from jsonb_array_elements(p_rows) r where coalesce(trim(r ->> 'provider_ref'), '') <> ''
  ), sys as (
    select id, provider_ref, amount from public.payments
    where provider = p_provider and status <> 'reversed' and received_at::date between p_from and p_to and provider_ref is not null
  )
  insert into public.reconciliation_lines (batch_id, provider_ref, amount, line_date, status, payment_id, system_amount)
  select v_id, coalesce(r.ref, s.provider_ref), r.amount, r.d,
         case when s.id is null then 'missing_in_system'::public.recon_status
              when r.ref is null then 'missing_in_provider'::public.recon_status
              when r.amount <> s.amount then 'amount_mismatch'::public.recon_status
              else 'matched'::public.recon_status end,
         s.id, s.amount
  from report r full outer join sys s on s.provider_ref = r.ref;

  select jsonb_object_agg(status, n) into v_summary from (select status::text, count(*) n from public.reconciliation_lines where batch_id = v_id group by status) x;
  update public.reconciliation_batches set summary = coalesce(v_summary, '{}'::jsonb) where id = v_id;
  return jsonb_build_object('id', v_id, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

create or replace function public.fx_rate_set(p_currency text, p_date date, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('accounting.update');
  if p_currency = 'USD' or not exists (select 1 from public.currencies where code = p_currency and active) then
    perform private.raise_app_error('VALIDATION', 'currency');
  end if;
  if p_rate is null or p_rate <= 0 then
    perform private.raise_app_error('VALIDATION', 'rate');
  end if;
  insert into public.fx_rates (currency, rate_date, rate, created_by) values (p_currency, p_date, p_rate, auth.uid())
  on conflict (currency, rate_date) do update set rate = excluded.rate, created_by = excluded.created_by, created_at = now();
end;
$$;

create or replace function public.period_set(p_year int, p_month int, p_lock boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('accounting.approve');
  insert into public.fiscal_periods (year, month, status, locked_by, locked_at)
  values (p_year, p_month, case when p_lock then 'locked'::public.period_status else 'open'::public.period_status end,
          case when p_lock then auth.uid() end, case when p_lock then now() end)
  on conflict (year, month) do update set status = excluded.status, locked_by = excluded.locked_by, locked_at = excluded.locked_at;
end;
$$;

/** Manual journal entry by an accountant; lines [{account, debit, credit, district_id}]. */
create or replace function public.journal_manual(p_date date, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_permission('accounting.create');
  if length(trim(coalesce(p_memo, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'memo');
  end if;
  if jsonb_array_length(p_lines) < 2 or exists (select 1 from jsonb_array_elements(p_lines) l
                                                 where not exists (select 1 from public.gl_accounts a where a.code = l ->> 'account' and a.active)) then
    perform private.raise_app_error('VALIDATION', 'lines');
  end if;
  begin
    v_id := private.post_journal(p_date, 'manual', null, trim(p_memo), p_lines);
  exception when raise_exception then
    if sqlerrm like 'unbalanced%' then
      perform private.raise_app_error('VALIDATION', 'unbalanced');
    end if;
    raise;
  end;
  return v_id;
end;
$$;

create or replace function public.trial_balance(p_from date, p_to date)
returns table (account text, name_so text, name_en text, type public.gl_type, debit numeric, credit numeric, balance numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.code, a.name_so, a.name_en, a.type, coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0),
         case when a.type in ('asset', 'expense') then coalesce(sum(l.debit - l.credit), 0) else coalesce(sum(l.credit - l.debit), 0) end
  from public.gl_accounts a
  left join public.journal_lines l on l.account = a.code
    and exists (select 1 from public.journal_entries e where e.id = l.entry_id and e.entry_date between p_from and p_to)
  group by a.code, a.name_so, a.name_en, a.type
  order by a.code;
$$;

create or replace function public.payment_provider_set(p_code text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('settings.update');
  update public.payment_providers set enabled = p_enabled where code = p_code;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'provider');
  end if;
end;
$$;

create or replace function public.payments_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'today', (select coalesce(sum(amount_base), 0) from public.payments where status = 'completed' and received_at::date = current_date),
    'today_count', (select count(*) from public.payments where status = 'completed' and received_at::date = current_date),
    'unmatched', (select count(*) from public.payments where status = 'unmatched'),
    'reversals_pending', (select count(*) from public.payment_reversals where status = 'pending'),
    'shifts_open', (select count(*) from public.cashier_shifts where status = 'open'),
    'shifts_to_approve', (select count(*) from public.cashier_shifts where status = 'closed'));
$$;

-- Expire stale intents hourly (where pg_cron exists).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-payment-intents', '7 * * * *',
      $job$update public.payment_intents set status = 'expired' where status = 'pending' and expires_at < now()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.shift_open(uuid, numeric), public.cashier_take_payment(uuid, jsonb), public.shift_close(uuid, numeric, text), public.shift_approve(uuid),
  public.payment_intent_create(uuid, text, text, text), public.payment_intent_set_checkout(uuid, text, text), public.payment_intent_status(uuid),
  public.webhook_ingest(text, text, boolean, jsonb, jsonb), public.payment_record_manual(jsonb), public.payment_match(uuid, uuid),
  public.payment_apply_credit(uuid), public.reversal_request(uuid, text), public.reversal_decide(uuid, boolean, text),
  public.reconciliation_run(text, date, date, jsonb), public.fx_rate_set(text, date, numeric), public.period_set(int, int, boolean),
  public.journal_manual(date, text, jsonb), public.trial_balance(date, date), public.payments_counts(), private.can_view_payment(uuid, uuid),
  public.payment_provider_set(text, boolean)
from public, anon;
grant execute on function
  public.shift_open(uuid, numeric), public.cashier_take_payment(uuid, jsonb), public.shift_close(uuid, numeric, text), public.shift_approve(uuid),
  public.payment_intent_create(uuid, text, text, text), public.payment_intent_status(uuid), public.payment_record_manual(jsonb),
  public.payment_match(uuid, uuid), public.payment_apply_credit(uuid), public.reversal_request(uuid, text), public.reversal_decide(uuid, boolean, text),
  public.reconciliation_run(text, date, date, jsonb), public.fx_rate_set(text, date, numeric), public.period_set(int, int, boolean),
  public.journal_manual(date, text, jsonb), public.trial_balance(date, date), public.payments_counts(), private.can_view_payment(uuid, uuid),
  public.payment_provider_set(text, boolean)
to authenticated;
-- The QR pay page is public: anyone with the token may start a payment and poll its status.
grant execute on function public.payment_intent_create(uuid, text, text, text), public.payment_intent_status(uuid) to anon;
grant execute on function public.webhook_ingest(text, text, boolean, jsonb, jsonb), public.payment_intent_set_checkout(uuid, text, text) to service_role;
revoke execute on function private.post_journal(date, text, uuid, text, jsonb), private.line_income_account(public.invoice_line_kind),
  private.invoice_line_post(), private.invoice_cancel_post(), private.fx_rate_for(text, date), private.clearing_account(public.payment_method),
  private.plan_apply(uuid, numeric), private.allocate_payment(uuid, uuid), private.record_payment(jsonb), private.reverse_payment(uuid, text)
from public, anon, authenticated;

-- Invoices issued before this migration get their opening journal now, so the ledger matches the debtors.
do $$
declare
  r record;
begin
  for r in select l.*, i.number, i.district_id from public.invoice_lines l join public.invoices i on i.id = l.invoice_id order by l.created_at loop
    if r.amount > 0 then
      perform private.post_journal(r.created_at::date, 'invoice', r.invoice_id, r.number || ' — ' || r.description,
        jsonb_build_array(jsonb_build_object('account', '1200', 'debit', r.amount, 'district_id', r.district_id),
                          jsonb_build_object('account', private.line_income_account(r.kind), 'credit', r.amount, 'district_id', r.district_id)));
    elsif r.amount < 0 then
      perform private.post_journal(r.created_at::date, 'invoice', r.invoice_id, r.number || ' — ' || r.description,
        jsonb_build_array(jsonb_build_object('account', '5100', 'debit', -r.amount, 'district_id', r.district_id),
                          jsonb_build_object('account', '1200', 'credit', -r.amount, 'district_id', r.district_id)));
    end if;
  end loop;
end;
$$;
