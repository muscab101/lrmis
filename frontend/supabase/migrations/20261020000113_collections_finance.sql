-- Cashier → Collections → Reconciliation → Finance approval → Accounting: the pieces that were missing.
--
-- * Collections Officer role: reviews payments, matches statements, verifies or disputes, investigates.
-- * Cash handovers: after closing a shift the cashier hands the counted cash to a named receiver, who confirms
--   what they actually got; a difference stays on record.
-- * Statement reconciliation workspace: an uploaded wallet / bank statement (batch) is worked line by line —
--   a statement entry with no system payment can be matched by hand, every difference must be explained — then
--   submitted, and approved by a second person (reconciliation.approve, not the preparer). Approval marks the
--   matched payments Reconciled and locks the batch; later corrections go through the payment correction / reversal
--   flows. Rejection sends it back to work on.
-- * Commission and revenue sharing: configurable rules (payment way, wallet, fee type, district; % and / or fixed;
--   effective dates), versioned; a rule counts only once someone other than its author approves it. Approved rules
--   accrue on every eligible payment (Dr commission or share expense / Cr payable to the party); a reversed payment
--   reverses them. Payouts settle what is payable, again approved by a second person.
-- * Ledger: general_ledger (one account, a period, opening balance and running balance) and collections_channels
--   (per way of paying: recorded, verified, pending, disputed, duplicates, statement totals and differences).
-- Owner decisions 2026-10-26: commission engine without rules (none calculate until added and approved); a second
-- person for reconciliation, commission rules and payouts; Accounting deposits / money out keep self-confirmation.

-- ---------------------------------------------------------------------------
-- Collections Officer
-- ---------------------------------------------------------------------------
insert into public.roles (key, name_so, name_en, description, colour, is_system, data_scope, default_permissions)
values ('collections_officer', 'Sarkaalka Ururinta', 'Collections Officer',
        'Review payments, match wallet and bank statements, verify or dispute, investigate differences.', '#0E7490', true, 'all',
        array['dashboard.view', 'cashier.view', 'payments.view', 'payments.export', 'payments.print', 'invoices.view',
              'reconciliation.view', 'reconciliation.create', 'reconciliation.update', 'reconciliation.export', 'reports.view', 'reports.export'])
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(r.default_permissions) k
 where r.key = 'collections_officer' and exists (select 1 from public.permissions p where p.key = k)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Accounts and journal sources
-- ---------------------------------------------------------------------------
insert into public.gl_accounts (code, name_so, name_en, type) values
  ('2200', 'Gunnooyinka la bixinayo', 'Commissions payable', 'liability'),
  ('2210', 'Qaybta dakhliga ee la bixinayo', 'Revenue shares payable', 'liability'),
  ('5400', 'Gunnooyinka iyo khidmadaha lacag-bixinta', 'Commissions and transaction fees', 'expense'),
  ('5410', 'Qaybaha dakhliga', 'Revenue shares', 'expense')
on conflict (code) do nothing;

create or replace function private.system_account(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('1100', '1110', '1120', '1130', '1200', '1500', '1590', '2100', '2200', '2210', '3100', '4100', '4110', '4200',
                    '4300', '4400', '5100', '5300', '5400', '5410');
$$;

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
  'invoice', 'invoice_cancel', 'payment', 'reversal', 'manual', 'payment_correction',
  'movement', 'movement_cancel', 'asset', 'asset_cancel', 'depreciation', 'disposal',
  'commission', 'commission_reversal', 'payout'));

-- ---------------------------------------------------------------------------
-- Cash handovers
-- ---------------------------------------------------------------------------
create table public.cash_handovers (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  shift_id         uuid not null references public.cashier_shifts (id),
  district_id      uuid references public.districts (id),
  from_user        uuid not null references auth.users (id),
  to_user          uuid not null references auth.users (id),
  amount           numeric(14, 2) not null check (amount >= 0),
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'received', 'disputed', 'cancelled')),
  received_amount  numeric(14, 2),
  difference       numeric(14, 2),
  receive_note     text,
  created_at       timestamptz not null default now(),
  received_at      timestamptz,
  check (from_user <> to_user)
);
-- One live handover per shift.
create unique index cash_handovers_shift_uidx on public.cash_handovers (shift_id) where status <> 'cancelled';
create index cash_handovers_to_idx on public.cash_handovers (to_user, status);
alter table public.cash_handovers enable row level security;
create policy cash_handovers_select on public.cash_handovers for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid()
         or ((public.has_permission('reconciliation.view') or public.has_permission('payments.approve'))
             and (district_id is null or public.can_access_district(district_id))));

/** Who may receive a shift's cash: staff covering the shift's district who verify, approve or keep the books. */
create or replace function public.handover_receivers(p_shift uuid)
returns table (user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.cashier_shifts;
begin
  select * into v from public.cashier_shifts where id = p_shift;
  if v.id is null or v.cashier_id <> auth.uid() then
    perform private.raise_app_error('NOT_FOUND', 'shift');
  end if;
  return query
  select p.user_id, p.full_name from public.profiles p
   where p.kind = 'staff' and p.status = 'active' and p.user_id <> auth.uid()
     and (private.user_has_permission(p.user_id, 'reconciliation.update') or private.user_has_permission(p.user_id, 'payments.approve')
          or private.user_has_permission(p.user_id, 'accounting.create'))
     and (v.district_id is null or private.user_can_access_district(p.user_id, v.district_id))
   order by p.full_name;
end;
$$;

/** The cashier hands a closed shift's cash to a receiver (by default the amount they counted). */
create or replace function public.handover_create(p_shift uuid, p_to uuid, p_amount numeric default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_shifts;
  v_id uuid;
  v_amount numeric;
begin
  perform private.assert_permission('cashier.update');
  select * into v from public.cashier_shifts where id = p_shift for update;
  if v.id is null or v.cashier_id <> auth.uid() then
    perform private.raise_app_error('NOT_FOUND', 'shift');
  end if;
  if v.status = 'open' then
    perform private.raise_app_error('CONFLICT', 'shift_open');
  end if;
  if exists (select 1 from public.cash_handovers where shift_id = p_shift and status <> 'cancelled') then
    perform private.raise_app_error('CONFLICT', 'handover_exists');
  end if;
  if p_to is null or not exists (select 1 from public.handover_receivers(p_shift) r where r.user_id = p_to) then
    perform private.raise_app_error('VALIDATION', 'receiver');
  end if;
  v_amount := round(coalesce(p_amount, v.counted_cash, 0), 2);
  if v_amount < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if v_amount <> coalesce(v.counted_cash, 0) and length(trim(coalesce(p_note, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  insert into public.cash_handovers (number, shift_id, district_id, from_user, to_user, amount, note)
  values ('HND-' || extract(year from now())::int || '-' || lpad(private.next_serial('HND-' || extract(year from now())::int)::text, 6, '0'),
          p_shift, v.district_id, auth.uid(), p_to, v_amount, nullif(trim(p_note), ''))
  returning id into v_id;
  perform private.notify(p_to, 'cash.handover', 'Lacag caddaan ah ayaa laguu wareejiyay: ' || v.number,
                         'Cash handed over to you: shift ' || v.number, '/collections?tab=handovers');
  perform private.audit('handover.create', 'cash_handovers', v_id::text, null, jsonb_build_object('shift', p_shift, 'to', p_to, 'amount', v_amount));
  return v_id;
end;
$$;

/** The receiver confirms what they actually received; a different amount needs a note and is kept as a difference. */
create or replace function public.handover_receive(p_id uuid, p_amount numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cash_handovers;
  v_amount numeric := round(p_amount, 2);
begin
  select * into v from public.cash_handovers where id = p_id for update;
  if v.id is null or v.to_user <> auth.uid() then
    perform private.raise_app_error('NOT_FOUND', 'handover');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v_amount is null or v_amount < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if v_amount <> v.amount and length(trim(coalesce(p_note, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.cash_handovers
     set status = case when v_amount = v.amount then 'received' else 'disputed' end, received_amount = v_amount,
         difference = v_amount - v.amount, receive_note = nullif(trim(p_note), ''), received_at = now()
   where id = p_id;
  perform private.audit('handover.receive', 'cash_handovers', p_id::text, to_jsonb(v), jsonb_build_object('received', v_amount, 'note', p_note));
end;
$$;

/** The cashier takes back a handover the receiver hasn't confirmed yet (wrong person, wrong amount). */
create or replace function public.handover_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cash_handovers;
begin
  select * into v from public.cash_handovers where id = p_id for update;
  if v.id is null or v.from_user <> auth.uid() then
    perform private.raise_app_error('NOT_FOUND', 'handover');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.cash_handovers set status = 'cancelled' where id = p_id;
  perform private.audit('handover.cancel', 'cash_handovers', p_id::text, to_jsonb(v), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Statement reconciliation workspace
-- ---------------------------------------------------------------------------
alter table public.reconciliation_batches
  add column if not exists status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'rejected')),
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references auth.users (id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users (id) on delete set null,
  add column if not exists decision_note text,
  add column if not exists note text;
alter table public.reconciliation_lines
  add column if not exists matched_by_hand boolean not null default false,
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users (id) on delete set null;

create or replace function private.recon_summary(p_batch uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status::text, count(*) n from public.reconciliation_lines where batch_id = p_batch group by status) x;
$$;

create or replace function private.recon_open_batch(p_batch uuid)
returns public.reconciliation_batches
language plpgsql
set search_path = ''
as $$
declare
  b public.reconciliation_batches;
begin
  perform private.assert_permission('reconciliation.update');
  select * into b from public.reconciliation_batches where id = p_batch for update;
  if b.id is null then
    perform private.raise_app_error('NOT_FOUND', 'batch');
  end if;
  if b.status not in ('open', 'rejected') then
    perform private.raise_app_error('CONFLICT', 'batch_locked');
  end if;
  return b;
end;
$$;

/** Payments of the batch's channel and dates that no line of the batch matches yet, for matching by hand. */
create or replace function public.recon_candidates(p_line bigint, p_q text default null)
returns table (payment_id uuid, receipt_no text, reference text, amount numeric, received_at timestamptz, payer_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.reconciliation_lines;
  b public.reconciliation_batches;
begin
  perform private.assert_permission('reconciliation.view');
  select * into l from public.reconciliation_lines where id = p_line;
  select * into b from public.reconciliation_batches where id = l.batch_id;
  if l.id is null then
    perform private.raise_app_error('NOT_FOUND', 'line');
  end if;
  return query
  select p.id, p.receipt_no, coalesce(p.provider_ref, p.reference), p.amount, p.received_at, p.payer_name
    from public.payments p
   where p.provider = b.provider and p.status <> 'reversed'
     and p.received_at::date between b.date_from - 7 and b.date_to + 7
     and not exists (select 1 from public.reconciliation_lines x where x.batch_id = b.id and x.payment_id = p.id and x.status <> 'missing_in_provider')
     and (coalesce(trim(p_q), '') = '' or p.receipt_no ilike '%' || trim(p_q) || '%' or coalesce(p.provider_ref, p.reference, '') ilike '%' || trim(p_q) || '%'
          or coalesce(p.payer_name, '') ilike '%' || trim(p_q) || '%')
   order by abs(p.amount - coalesce(l.amount, 0)), p.received_at desc
   limit 20;
end;
$$;

/**
 * Match a statement entry that found no system payment to a payment by hand. The payment's own "not on the
 * statement" line in this batch goes away; a different amount stays a mismatch (it still needs explaining).
 */
create or replace function public.recon_line_match(p_line bigint, p_payment uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.reconciliation_lines;
  b public.reconciliation_batches;
  p public.payments;
begin
  select * into l from public.reconciliation_lines where id = p_line for update;
  if l.id is null then
    perform private.raise_app_error('NOT_FOUND', 'line');
  end if;
  b := private.recon_open_batch(l.batch_id);
  if l.status <> 'missing_in_system' then
    perform private.raise_app_error('CONFLICT', 'line_matched');
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  select * into p from public.payments where id = p_payment;
  if p.id is null or p.status = 'reversed' or p.provider is distinct from b.provider then
    perform private.raise_app_error('VALIDATION', 'payment');
  end if;
  if exists (select 1 from public.reconciliation_lines x where x.batch_id = b.id and x.payment_id = p.id and x.status <> 'missing_in_provider') then
    perform private.raise_app_error('CONFLICT', 'payment_matched');
  end if;
  delete from public.reconciliation_lines where batch_id = b.id and payment_id = p.id and status = 'missing_in_provider';
  update public.reconciliation_lines
     set payment_id = p.id, system_amount = p.amount, matched_by_hand = true,
         status = case when l.amount = p.amount then 'matched'::public.recon_status else 'amount_mismatch'::public.recon_status end,
         resolution_note = trim(p_note), resolved_at = now(), resolved_by = auth.uid()
   where id = p_line;
  update public.reconciliation_batches set summary = private.recon_summary(b.id) where id = b.id;
  perform private.audit('recon.match', 'reconciliation_lines', p_line::text, to_jsonb(l), jsonb_build_object('payment', p.id, 'note', trim(p_note)));
end;
$$;

/** Explain a difference (missing, mismatch, duplicate …). The line keeps its status: the difference stays visible. */
create or replace function public.recon_line_resolve(p_line bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.reconciliation_lines;
begin
  select * into l from public.reconciliation_lines where id = p_line for update;
  if l.id is null then
    perform private.raise_app_error('NOT_FOUND', 'line');
  end if;
  perform private.recon_open_batch(l.batch_id);
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.reconciliation_lines set resolution_note = trim(p_note), resolved_at = now(), resolved_by = auth.uid() where id = p_line;
  perform private.audit('recon.resolve', 'reconciliation_lines', p_line::text, to_jsonb(l), jsonb_build_object('note', trim(p_note)));
end;
$$;

/** Send the batch for approval: every line that isn't a clean match must be explained. */
create or replace function public.recon_batch_submit(p_batch uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.reconciliation_batches;
  v_open int;
  v_user uuid;
begin
  b := private.recon_open_batch(p_batch);
  select count(*) into v_open from public.reconciliation_lines
   where batch_id = p_batch and status <> 'matched' and resolution_note is null;
  if v_open > 0 then
    perform private.raise_app_error('CONFLICT', 'unresolved:' || v_open);
  end if;
  update public.reconciliation_batches
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), note = nullif(trim(coalesce(p_note, '')), ''),
         summary = private.recon_summary(p_batch)
   where id = p_batch;
  for v_user in
    select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
     where rp.permission_key = 'reconciliation.approve' and ur.user_id <> auth.uid()
  loop
    perform private.notify(v_user, 'recon.submitted', 'Isu-dheellitir sugaya ansixin: ' || b.number,
                           'Reconciliation waiting for approval: ' || b.number, '/collections?tab=statements&batch=' || p_batch);
  end loop;
  perform private.audit('recon.submit', 'reconciliation_batches', p_batch::text, null, jsonb_build_object('note', p_note));
end;
$$;

/**
 * A second person approves (locks the batch; matched payments become Reconciled) or rejects (with a note; it goes
 * back to be worked on). Neither who uploaded nor who submitted it may decide.
 */
create or replace function public.recon_batch_decide(p_batch uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.reconciliation_batches;
begin
  perform private.assert_permission('reconciliation.approve');
  select * into b from public.reconciliation_batches where id = p_batch for update;
  if b.id is null then
    perform private.raise_app_error('NOT_FOUND', 'batch');
  end if;
  if b.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(b.created_by);
  perform private.assert_maker_checker(b.submitted_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 3 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.reconciliation_batches set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = trim(p_note) where id = p_batch;
    perform private.audit('recon.reject', 'reconciliation_batches', p_batch::text, null, jsonb_build_object('note', trim(p_note)));
    return;
  end if;
  update public.payments p set verify_status = 'reconciled', verified_by = coalesce(p.verified_by, auth.uid()), verified_at = coalesce(p.verified_at, now())
   where p.id in (select payment_id from public.reconciliation_lines where batch_id = p_batch and status = 'matched')
     and p.verify_status in ('pending', 'verified');
  update public.reconciliation_batches set status = 'approved', decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_batch;
  perform private.audit('recon.approve', 'reconciliation_batches', p_batch::text, null, jsonb_build_object('note', p_note));
end;
$$;

/** An uploaded batch nobody has submitted yet can be thrown away (a wrong file). */
create or replace function public.recon_batch_delete(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.reconciliation_batches;
begin
  b := private.recon_open_batch(p_batch);
  delete from public.reconciliation_batches where id = p_batch;
  perform private.audit('recon.delete', 'reconciliation_batches', p_batch::text, to_jsonb(b), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Commission and revenue sharing
-- ---------------------------------------------------------------------------
create table public.commission_rules (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  version          int not null default 1,
  name             text not null,
  kind             text not null check (kind in ('commission', 'revenue_share', 'fee')),
  party            text not null,
  -- Which payments: null = any.
  method           public.payment_method,
  wallet           text,
  fee_type_id      uuid references public.fee_types (id),
  district_id      uuid references public.districts (id),
  pct              numeric(7, 4) not null default 0 check (pct >= 0 and pct <= 100),
  fixed_amount     numeric(14, 2) not null default 0 check (fixed_amount >= 0),
  expense_account  text not null references public.gl_accounts (code),
  payable_account  text not null references public.gl_accounts (code),
  effective_from   date not null,
  effective_to     date,
  status           text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  approved_by      uuid references auth.users (id) on delete set null,
  unique (code, version),
  check (pct > 0 or fixed_amount > 0),
  check (effective_to is null or effective_to >= effective_from)
);
create table public.commission_payouts (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  party            text not null,
  payable_account  text not null references public.gl_accounts (code),
  upto             date not null,
  amount           numeric(14, 2) not null,
  paid_from        text not null references public.gl_accounts (code),
  reference        text,
  status           text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  journal_id       uuid references public.journal_entries (id),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decided_by       uuid references auth.users (id) on delete set null,
  decision_note    text
);
create table public.commission_entries (
  id            bigint generated always as identity primary key,
  rule_id       uuid not null references public.commission_rules (id),
  payment_id    uuid not null references public.payments (id),
  base_amount   numeric(14, 2) not null,
  amount        numeric(14, 2) not null check (amount > 0),
  status        text not null default 'accrued' check (status in ('accrued', 'reversed')),
  journal_id    uuid references public.journal_entries (id),
  reversal_journal_id uuid references public.journal_entries (id),
  payout_id     uuid references public.commission_payouts (id),
  created_at    timestamptz not null default now(),
  unique (rule_id, payment_id)
);
create index commission_entries_payment_idx on public.commission_entries (payment_id);
create index commission_entries_payout_idx on public.commission_entries (payout_id);
alter table public.commission_rules enable row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_payouts enable row level security;
create policy commission_rules_select on public.commission_rules for select to authenticated
  using (public.has_permission('accounting.view') or public.has_permission('payments.approve') or public.has_permission('reconciliation.view'));
create policy commission_entries_select on public.commission_entries for select to authenticated
  using (public.has_permission('accounting.view') or public.has_permission('payments.approve') or public.has_permission('reconciliation.view'));
create policy commission_payouts_select on public.commission_payouts for select to authenticated
  using (public.has_permission('accounting.view') or public.has_permission('payments.approve'));

/** What a rule takes from one payment (0 when the payment doesn't qualify). */
create or replace function private.commission_for(r public.commission_rules, p public.payments)
returns numeric[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base numeric;
begin
  if p.status <> 'completed' or p.received_at::date < r.effective_from or (r.effective_to is not null and p.received_at::date > r.effective_to)
     or (r.method is not null and p.method <> r.method) or (r.wallet is not null and p.wallet is distinct from r.wallet)
     or (r.district_id is not null and p.district_id is distinct from r.district_id) then
    return array[0, 0];
  end if;
  if r.fee_type_id is null then
    v_base := p.amount_base;
  else
    select coalesce(sum(a.amount), 0) into v_base from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
     where a.payment_id = p.id and i.fee_type_id = r.fee_type_id;
  end if;
  if v_base <= 0 then
    return array[0, 0];
  end if;
  return array[v_base, round(v_base * r.pct / 100 + r.fixed_amount, 2)];
end;
$$;

/** Accrue every approved rule (or just p_rule) on a payment no version of that rule has been accrued on yet. */
create or replace function private.commission_accrue(p_payment uuid, p_rule uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  r public.commission_rules;
  v numeric[];
  v_je uuid;
begin
  select * into p from public.payments where id = p_payment;
  if p.id is null or p.status <> 'completed' then
    return;
  end if;
  for r in select * from public.commission_rules
            where status in ('approved', 'retired') and approved_at is not null and (p_rule is null or id = p_rule)
              -- once per rule code: a newer version never charges a payment an earlier version already charged
              and not exists (select 1 from public.commission_entries e join public.commission_rules r2 on r2.id = e.rule_id
                               where r2.code = commission_rules.code and e.payment_id = p.id) loop
    v := private.commission_for(r, p);
    continue when v[2] <= 0;
    v_je := private.post_journal(p.received_at::date, 'commission', p.id, r.name || ' — ' || p.receipt_no,
      jsonb_build_array(jsonb_build_object('account', r.expense_account, 'debit', v[2], 'district_id', p.district_id),
                        jsonb_build_object('account', r.payable_account, 'credit', v[2], 'district_id', p.district_id)));
    insert into public.commission_entries (rule_id, payment_id, base_amount, amount, journal_id) values (r.id, p.id, v[1], v[2], v_je);
  end loop;
end;
$$;

/** A reversed payment reverses its commissions (what was already paid out becomes owed back by the party). */
create or replace function private.commission_reverse(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_je uuid;
begin
  for e in select ce.*, r.expense_account, r.payable_account, r.name, p.district_id, p.receipt_no
             from public.commission_entries ce join public.commission_rules r on r.id = ce.rule_id join public.payments p on p.id = ce.payment_id
            where ce.payment_id = p_payment and ce.status = 'accrued' loop
    v_je := private.post_journal(current_date, 'commission_reversal', p_payment, e.name || ' reversed — ' || e.receipt_no,
      jsonb_build_array(jsonb_build_object('account', e.payable_account, 'debit', e.amount, 'district_id', e.district_id),
                        jsonb_build_object('account', e.expense_account, 'credit', e.amount, 'district_id', e.district_id)));
    update public.commission_entries set status = 'reversed', reversal_journal_id = v_je where id = e.id;
  end loop;
end;
$$;

-- At commit, once the payment's allocations exist (a fee-type rule needs them).
create or replace function private.payment_commissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    perform private.commission_accrue(new.id);
  elsif new.status = 'reversed' then
    perform private.commission_reverse(new.id);
  end if;
  return null;
end;
$$;
create constraint trigger payment_commissions after insert or update of status on public.payments
  deferrable initially deferred for each row execute function private.payment_commissions();

/**
 * Draft or change (while draft) a rule. p: {code, name, kind, party, method, wallet, fee_type_id, district_id, pct,
 * fixed_amount, effective_from, effective_to, note}. With p_from_rule (an approved rule), starts its next version.
 */
create or replace function public.commission_rule_save(p_id uuid, p jsonb, p_from_rule uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commission_rules;
  base public.commission_rules;
  v_kind text := coalesce(p ->> 'kind', 'commission');
  v_pct numeric;
  v_fixed numeric;
  v_from date;
  v_to date;
  v_id uuid;
  v_code text := lower(trim(coalesce(p ->> 'code', '')));
  v_version int := 1;
begin
  perform private.assert_permission('accounting.update');
  begin
    v_pct := round(coalesce(nullif(p ->> 'pct', '')::numeric, 0), 4);
    v_fixed := round(coalesce(nullif(p ->> 'fixed_amount', '')::numeric, 0), 2);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'pct');
  end;
  begin
    v_from := (p ->> 'effective_from')::date;
    v_to := nullif(p ->> 'effective_to', '')::date;
  exception when others then
    perform private.raise_app_error('VALIDATION', 'effective_from');
  end;
  if v_kind not in ('commission', 'revenue_share', 'fee') then
    perform private.raise_app_error('VALIDATION', 'kind');
  end if;
  if length(trim(coalesce(p ->> 'name', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'name');
  end if;
  if length(trim(coalesce(p ->> 'party', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'party');
  end if;
  if v_pct < 0 or v_pct > 100 or v_fixed < 0 or (v_pct = 0 and v_fixed = 0) then
    perform private.raise_app_error('VALIDATION', 'pct');
  end if;
  if v_from is null or (v_to is not null and v_to < v_from) then
    perform private.raise_app_error('VALIDATION', 'effective_from');
  end if;
  if nullif(p ->> 'method', '') is not null and (p ->> 'method') not in ('cash', 'cheque', 'mobile_money', 'card', 'bank_transfer') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;

  if p_from_rule is not null then
    select * into base from public.commission_rules where id = p_from_rule;
    if base.id is null or base.status <> 'approved' then
      perform private.raise_app_error('CONFLICT', 'status');
    end if;
    if v_from <= base.effective_from then
      perform private.raise_app_error('VALIDATION', 'effective_from');
    end if;
    if exists (select 1 from public.commission_rules where code = base.code and status = 'draft') then
      perform private.raise_app_error('CONFLICT', 'draft_exists');
    end if;
    v_code := base.code;
    select max(version) + 1 into v_version from public.commission_rules where code = base.code;
  elsif p_id is null then
    if v_code !~ '^[a-z0-9_]{2,40}$' then
      perform private.raise_app_error('VALIDATION', 'code');
    end if;
    if exists (select 1 from public.commission_rules where code = v_code) then
      perform private.raise_app_error('CONFLICT', 'code_taken');
    end if;
  end if;

  if p_id is not null then
    select * into v from public.commission_rules where id = p_id for update;
    if v.id is null then
      perform private.raise_app_error('NOT_FOUND', 'rule');
    end if;
    if v.status <> 'draft' then
      perform private.raise_app_error('CONFLICT', 'rule_locked');
    end if;
    update public.commission_rules
       set name = trim(p ->> 'name'), kind = v_kind, party = trim(p ->> 'party'), method = nullif(p ->> 'method', '')::public.payment_method,
           wallet = nullif(p ->> 'wallet', ''), fee_type_id = nullif(p ->> 'fee_type_id', '')::uuid, district_id = nullif(p ->> 'district_id', '')::uuid,
           pct = v_pct, fixed_amount = v_fixed, effective_from = v_from, effective_to = v_to, note = nullif(trim(p ->> 'note'), ''),
           expense_account = case when v_kind = 'revenue_share' then '5410' else '5400' end,
           payable_account = case when v_kind = 'revenue_share' then '2210' else '2200' end
     where id = p_id;
    perform private.audit('commission_rule.update', 'commission_rules', p_id::text, to_jsonb(v), p);
    return p_id;
  end if;
  insert into public.commission_rules (code, version, name, kind, party, method, wallet, fee_type_id, district_id, pct, fixed_amount,
                                       expense_account, payable_account, effective_from, effective_to, note, created_by)
  values (v_code, v_version, trim(p ->> 'name'), v_kind, trim(p ->> 'party'), nullif(p ->> 'method', '')::public.payment_method,
          nullif(p ->> 'wallet', ''), nullif(p ->> 'fee_type_id', '')::uuid, nullif(p ->> 'district_id', '')::uuid, v_pct, v_fixed,
          case when v_kind = 'revenue_share' then '5410' else '5400' end, case when v_kind = 'revenue_share' then '2210' else '2200' end,
          v_from, v_to, nullif(trim(p ->> 'note'), ''), auth.uid())
  returning id into v_id;
  perform private.audit('commission_rule.create', 'commission_rules', v_id::text, null, p);
  return v_id;
end;
$$;

/**
 * Approve a draft rule (not its author). It replaces the code's earlier version from its start date and
 * accrues on every eligible payment since then. Returns how many payments it accrued on.
 */
create or replace function public.commission_rule_approve(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commission_rules;
  v_pay uuid;
  v_before int;
  v_after int;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.commission_rules where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'rule');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  update public.commission_rules set status = 'retired', effective_to = least(coalesce(effective_to, v.effective_from - 1), v.effective_from - 1)
   where code = v.code and status = 'approved' and id <> p_id;
  update public.commission_rules set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_id;
  select count(*) into v_before from public.commission_entries where rule_id = p_id;
  for v_pay in select id from public.payments where status = 'completed' and received_at::date >= v.effective_from
                  and (v.effective_to is null or received_at::date <= v.effective_to) loop
    perform private.commission_accrue(v_pay, p_id);
  end loop;
  select count(*) into v_after from public.commission_entries where rule_id = p_id;
  perform private.audit('commission_rule.approve', 'commission_rules', p_id::text, to_jsonb(v), jsonb_build_object('accrued', v_after - v_before));
  return v_after - v_before;
end;
$$;

/** Stop an approved rule from a date on (payments after it no longer accrue). */
create or replace function public.commission_rule_retire(p_id uuid, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commission_rules;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.commission_rules where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'rule');
  end if;
  if v.status <> 'approved' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if p_to is null or p_to < v.effective_from then
    perform private.raise_app_error('VALIDATION', 'effective_to');
  end if;
  update public.commission_rules set status = 'retired', effective_to = p_to where id = p_id;
  perform private.audit('commission_rule.retire', 'commission_rules', p_id::text, to_jsonb(v), jsonb_build_object('to', p_to));
end;
$$;

/** Delete a draft rule. */
create or replace function public.commission_rule_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commission_rules;
begin
  perform private.assert_permission('accounting.update');
  select * into v from public.commission_rules where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'rule');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'rule_locked');
  end if;
  delete from public.commission_rules where id = p_id;
  perform private.audit('commission_rule.delete', 'commission_rules', p_id::text, to_jsonb(v), null);
end;
$$;

/** Prepare a payout of everything accrued for a party up to a date, from a money account. */
create or replace function public.commission_payout_create(p_party text, p_payable text, p_upto date, p_paid_from text, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_amount numeric;
begin
  perform private.assert_permission('accounting.create');
  if not private.money_account(p_paid_from) then
    perform private.raise_app_error('VALIDATION', 'paid_from');
  end if;
  if p_upto is null or p_upto > current_date then
    perform private.raise_app_error('VALIDATION', 'upto');
  end if;
  select coalesce(sum(e.amount), 0) into v_amount
    from public.commission_entries e join public.commission_rules r on r.id = e.rule_id join public.payments p on p.id = e.payment_id
   where r.party = p_party and r.payable_account = p_payable and e.status = 'accrued' and e.payout_id is null and p.received_at::date <= p_upto;
  if v_amount <= 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_payable');
  end if;
  insert into public.commission_payouts (number, party, payable_account, upto, amount, paid_from, reference, created_by)
  values ('PAY-' || extract(year from now())::int || '-' || lpad(private.next_serial('CPAY-' || extract(year from now())::int)::text, 5, '0'),
          p_party, p_payable, p_upto, v_amount, p_paid_from, nullif(trim(coalesce(p_reference, '')), ''), auth.uid())
  returning id into v_id;
  update public.commission_entries e set payout_id = v_id
    from public.commission_rules r, public.payments p
   where r.id = e.rule_id and p.id = e.payment_id and r.party = p_party and r.payable_account = p_payable
     and e.status = 'accrued' and e.payout_id is null and p.received_at::date <= p_upto;
  perform private.audit('payout.create', 'commission_payouts', v_id::text, null, jsonb_build_object('party', p_party, 'amount', v_amount));
  return v_id;
end;
$$;

/** A second person pays it (Dr payable / Cr money account) or rejects it (its entries become payable again). */
create or replace function public.commission_payout_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commission_payouts;
  v_je uuid;
begin
  perform private.assert_permission('payments.approve');
  select * into v from public.commission_payouts where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'payout');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 3 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.commission_entries set payout_id = null where payout_id = p_id;
    update public.commission_payouts set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = trim(p_note) where id = p_id;
    return;
  end if;
  -- Reversed since it was prepared: pay only what is still owed.
  select coalesce(sum(amount), 0) into v.amount from public.commission_entries where payout_id = p_id and status = 'accrued';
  if v.amount <= 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_payable');
  end if;
  v_je := private.post_journal(current_date, 'payout', p_id, v.number || ' — ' || v.party || coalesce(' (' || v.reference || ')', ''),
    jsonb_build_array(jsonb_build_object('account', v.payable_account, 'debit', v.amount),
                      jsonb_build_object('account', v.paid_from, 'credit', v.amount)));
  update public.commission_payouts set status = 'paid', amount = v.amount, journal_id = v_je, decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
  perform private.audit('payout.pay', 'commission_payouts', p_id::text, null, jsonb_build_object('amount', v.amount, 'journal', v_je));
end;
$$;

/** Per party: gross collections the rules applied to, accrued, reversed, paid and still payable, for [p_from, p_to]. */
create or replace function public.commission_summary(p_from date, p_to date)
returns table (party text, payable_account text, kind text, payments bigint, base numeric, accrued numeric, reversed numeric,
               paid numeric, payable numeric, in_payout numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('accounting.view') or public.has_permission('payments.approve') or public.has_permission('reconciliation.view')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'accounting.view');
  end if;
  return query
  select r.party, r.payable_account, min(r.kind), count(distinct e.payment_id), coalesce(sum(e.base_amount), 0),
         coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.status = 'reversed'), 0),
         coalesce(sum(e.amount) filter (where e.status = 'accrued' and po.status = 'paid'), 0),
         coalesce(sum(e.amount) filter (where e.status = 'accrued' and (po.id is null or po.status <> 'paid')), 0),
         coalesce(sum(e.amount) filter (where e.status = 'accrued' and po.status = 'pending'), 0)
    from public.commission_entries e
    join public.commission_rules r on r.id = e.rule_id
    join public.payments p on p.id = e.payment_id
    left join public.commission_payouts po on po.id = e.payout_id
   where p.received_at::date between p_from and p_to
   group by r.party, r.payable_account
   order by 9 desc, 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger and channel reports
-- ---------------------------------------------------------------------------
/** One account for a period: opening balance, every line with its running balance (debit side for assets/expenses). */
create or replace function public.general_ledger(p_account text, p_from date, p_to date, p_district uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.gl_accounts;
  v_sign int;
  v_open numeric;
begin
  perform private.assert_permission('accounting.view');
  select * into a from public.gl_accounts where code = p_account;
  if a.code is null then
    perform private.raise_app_error('NOT_FOUND', 'account');
  end if;
  v_sign := case when a.type in ('asset', 'expense') then 1 else -1 end;
  select coalesce(sum(l.debit - l.credit), 0) * v_sign into v_open
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
   where l.account = p_account and e.entry_date < p_from and (p_district is null or l.district_id = p_district);
  return jsonb_build_object('account', to_jsonb(a), 'from', p_from, 'to', p_to, 'opening', v_open,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('entry_id', x.entry_id, 'number', x.number, 'date', x.entry_date, 'source', x.source, 'memo', x.memo,
                                          'debit', x.debit, 'credit', x.credit, 'district_id', x.district_id,
                                          'balance', v_open + x.run) order by x.entry_date, x.created_at, x.id)
      from (select l.id, l.entry_id, e.number, e.entry_date, e.created_at, e.source, e.memo, l.debit, l.credit, l.district_id,
                   sum((l.debit - l.credit) * v_sign) over (order by e.entry_date, e.created_at, l.id) run
              from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
             where l.account = p_account and e.entry_date between p_from and p_to and (p_district is null or l.district_id = p_district)) x), '[]'::jsonb),
    'debit', (select coalesce(sum(l.debit), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
               where l.account = p_account and e.entry_date between p_from and p_to and (p_district is null or l.district_id = p_district)),
    'credit', (select coalesce(sum(l.credit), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                where l.account = p_account and e.entry_date between p_from and p_to and (p_district is null or l.district_id = p_district)));
end;
$$;

/**
 * Per way of paying for [p_from, p_to]: what was recorded, verified / reconciled, pending, disputed, how many look
 * like duplicates, and what the uploaded statements say (statement total, missing in the system, not on the
 * statement, amount differences).
 */
create or replace function public.collections_channels(p_from date, p_to date)
returns table (channel text, recorded_n bigint, recorded numeric, verified numeric, reconciled numeric, pending numeric, disputed numeric,
               duplicates bigint, statement_total numeric, missing_in_system_n bigint, missing_in_system numeric,
               missing_in_provider_n bigint, missing_in_provider numeric, mismatch_n bigint, mismatch numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  return query
  with pay as (
    select private.collection_channel(p.method, p.wallet) ch, p.* from public.payments p
     where p.status <> 'reversed' and p.received_at::date between p_from and p_to and private.can_view_payment(p.district_id, p.parcel_id)
  ), dup as (
    select distinct d.payment_id from public.payment_duplicates(p_from, p_to) d
  ), lines as (
    select case b.provider when 'bank' then 'bank_transfer' when 'cash' then 'cash' when 'stripe' then 'card'
                           when 'evc_plus' then 'evc_plus' when 'edahab' then 'edahab' when 'zaad' then 'zaad' else 'other' end ch, l.*
      from public.reconciliation_lines l join public.reconciliation_batches b on b.id = l.batch_id
     where coalesce(l.line_date, b.date_from) between p_from and p_to
  ), chans as (
    select unnest(array['cash', 'evc_plus', 'edahab', 'zaad', 'bank_transfer', 'card', 'other']) ch
  )
  select c.ch,
         (select count(*) from pay where pay.ch = c.ch),
         (select coalesce(sum(amount_base), 0) from pay where pay.ch = c.ch),
         (select coalesce(sum(amount_base), 0) from pay where pay.ch = c.ch and verify_status = 'verified'),
         (select coalesce(sum(amount_base), 0) from pay where pay.ch = c.ch and verify_status = 'reconciled'),
         (select coalesce(sum(amount_base), 0) from pay where pay.ch = c.ch and verify_status = 'pending'),
         (select coalesce(sum(amount_base), 0) from pay where pay.ch = c.ch and verify_status = 'disputed'),
         (select count(*) from pay where pay.ch = c.ch and pay.id in (select payment_id from dup)),
         (select coalesce(sum(amount), 0) from lines where lines.ch = c.ch),
         (select count(*) from lines where lines.ch = c.ch and status = 'missing_in_system'),
         (select coalesce(sum(amount), 0) from lines where lines.ch = c.ch and status = 'missing_in_system'),
         (select count(*) from lines where lines.ch = c.ch and status = 'missing_in_provider'),
         (select coalesce(sum(system_amount), 0) from lines where lines.ch = c.ch and status = 'missing_in_provider'),
         (select count(*) from lines where lines.ch = c.ch and status = 'amount_mismatch'),
         (select coalesce(sum(amount - system_amount), 0) from lines where lines.ch = c.ch and status = 'amount_mismatch')
    from chans c;
end;
$$;

revoke all on function private.recon_summary(uuid), private.recon_open_batch(uuid), private.commission_for(public.commission_rules, public.payments),
  private.commission_accrue(uuid, uuid), private.commission_reverse(uuid), private.payment_commissions() from public, anon, authenticated;
revoke all on function public.handover_receivers(uuid), public.handover_create(uuid, uuid, numeric, text), public.handover_receive(uuid, numeric, text),
  public.handover_cancel(uuid), public.recon_candidates(bigint, text), public.recon_line_match(bigint, uuid, text), public.recon_line_resolve(bigint, text),
  public.recon_batch_submit(uuid, text), public.recon_batch_decide(uuid, boolean, text), public.recon_batch_delete(uuid),
  public.commission_rule_save(uuid, jsonb, uuid), public.commission_rule_approve(uuid), public.commission_rule_retire(uuid, date),
  public.commission_rule_delete(uuid), public.commission_payout_create(text, text, date, text, text), public.commission_payout_decide(uuid, boolean, text),
  public.commission_summary(date, date), public.general_ledger(text, date, date, uuid), public.collections_channels(date, date) from public, anon;
grant execute on function public.handover_receivers(uuid), public.handover_create(uuid, uuid, numeric, text), public.handover_receive(uuid, numeric, text),
  public.handover_cancel(uuid), public.recon_candidates(bigint, text), public.recon_line_match(bigint, uuid, text), public.recon_line_resolve(bigint, text),
  public.recon_batch_submit(uuid, text), public.recon_batch_decide(uuid, boolean, text), public.recon_batch_delete(uuid),
  public.commission_rule_save(uuid, jsonb, uuid), public.commission_rule_approve(uuid), public.commission_rule_retire(uuid, date),
  public.commission_rule_delete(uuid), public.commission_payout_create(text, text, date, text, text), public.commission_payout_decide(uuid, boolean, text),
  public.commission_summary(date, date), public.general_ledger(text, date, date, uuid), public.collections_channels(date, date) to authenticated;
