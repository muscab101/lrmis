-- Accounting you can work with: money in and out, bank deposits of district collections, the office's
-- assets, and the chart of accounts.
--
-- * Money movements: a bank deposit (district cash / mobile money / card → a bank account), money out
--   (an expense paid from a money account) and other money in (grants, opening balances …). Anyone with
--   accounting.create records one; it reaches the books only when someone with accounting.approve
--   confirms it (they may confirm their own: owner decision, 2026-10-25). A confirmed one is cancelled by
--   a reversing entry, never deleted.
-- * Fixed assets: buildings, vehicles, computers … bought from a money account (or already owned →
--   accumulated surplus), depreciated month by month (straight line), disposed with the gain or loss.
-- * Chart of accounts: add, rename and switch off accounts; mark bank accounts. Accounts the system posts
--   to can't be switched off. A manual journal entry can be reversed once.
-- * Reports: accounting_overview (balances, money in / out, pending, assets) and accounting_districts
--   (per district: billed, collected by channel, deposited, still held, owed).

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
alter table public.gl_accounts add column if not exists is_bank boolean not null default false;
update public.gl_accounts set is_bank = true where code = '1130';

insert into public.gl_accounts (code, name_so, name_en, type) values
  ('1500', 'Hantida go''an', 'Fixed assets', 'asset'),
  ('1590', 'Qiima-dhaca la isku geeyay', 'Accumulated depreciation', 'asset'),
  ('4400', 'Faa''iido / khasaare iibinta hantida', 'Gain or loss on asset disposal', 'income'),
  ('4500', 'Dakhli kale', 'Other income', 'income'),
  ('5210', 'Mushaharka', 'Salaries and wages', 'expense'),
  ('5220', 'Agabka xafiiska', 'Office supplies', 'expense'),
  ('5230', 'Shidaal iyo gaadiid', 'Fuel and transport', 'expense'),
  ('5240', 'Koronto, biyo iyo isgaarsiin', 'Utilities and communication', 'expense'),
  ('5250', 'Khidmadaha bangiga', 'Bank charges', 'expense'),
  ('5260', 'Dayactir', 'Repairs and maintenance', 'expense'),
  ('5300', 'Qiima-dhac', 'Depreciation', 'expense')
on conflict (code) do nothing;

/** Accounts the system posts to by itself: they can't be switched off, deleted or change type. */
create or replace function private.system_account(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('1100', '1110', '1120', '1130', '1200', '1500', '1590', '2100', '3100', '4100', '4110', '4200', '4300', '4400', '5100', '5300');
$$;

/** A money account: cash, mobile money, card clearing or a bank (asset accounts 11xx). */
create or replace function private.money_account(p_code text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.gl_accounts where code = p_code and type = 'asset' and active and code like '11__');
$$;

-- Postings from this migration.
do $$
declare v text;
begin
  for v in select conname from pg_constraint where conrelid = 'public.journal_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%' loop
    execute format('alter table public.journal_entries drop constraint %I', v);
  end loop;
end;
$$;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
  'invoice', 'invoice_cancel', 'payment', 'reversal', 'manual', 'payment_correction',
  'movement', 'movement_cancel', 'asset', 'asset_cancel', 'depreciation', 'disposal'));
alter table public.journal_entries add column if not exists reverses uuid references public.journal_entries (id);
alter table public.journal_entries add column if not exists reversed_by uuid references public.journal_entries (id);

/** Add or change an account. p: {code, name_so, name_en, type, is_bank, active}. */
create or replace function public.gl_account_save(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.gl_accounts;
  v_code text := trim(coalesce(p ->> 'code', ''));
  v_type public.gl_type;
  v_bank boolean := coalesce((p ->> 'is_bank')::boolean, false);
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
begin
  perform private.assert_permission('accounting.update');
  if v_code !~ '^[0-9]{4}$' then
    perform private.raise_app_error('VALIDATION', 'code');
  end if;
  if length(trim(coalesce(p ->> 'name_so', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_so');
  end if;
  if length(trim(coalesce(p ->> 'name_en', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_en');
  end if;
  begin
    v_type := (p ->> 'type')::public.gl_type;
  exception when others then
    perform private.raise_app_error('VALIDATION', 'type');
  end;
  if v_type is null then
    perform private.raise_app_error('VALIDATION', 'type');
  end if;
  -- A bank account is a money account (11xx).
  if v_bank and not (v_type = 'asset' and v_code like '11__') then
    perform private.raise_app_error('VALIDATION', 'is_bank');
  end if;

  select * into v from public.gl_accounts where code = v_code for update;
  if v.code is null then
    insert into public.gl_accounts (code, name_so, name_en, type, is_bank, active)
    values (v_code, trim(p ->> 'name_so'), trim(p ->> 'name_en'), v_type, v_bank, v_active);
    perform private.audit('gl_account.create', 'gl_accounts', v_code, null, p);
    return v_code;
  end if;
  if v.type <> v_type and (private.system_account(v_code) or exists (select 1 from public.journal_lines where account = v_code)) then
    perform private.raise_app_error('CONFLICT', 'account_used');
  end if;
  if not v_active and private.system_account(v_code) then
    perform private.raise_app_error('CONFLICT', 'system_account');
  end if;
  update public.gl_accounts set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), type = v_type,
         is_bank = case when v_code = '1130' then true else v_bank end, active = v_active
   where code = v_code;
  perform private.audit('gl_account.update', 'gl_accounts', v_code, to_jsonb(v), p);
  return v_code;
end;
$$;

/** Delete an account nothing was posted to; one with postings is switched off instead. Returns 'deleted' or 'deactivated'. */
create or replace function public.gl_account_delete(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.gl_accounts;
begin
  perform private.assert_permission('accounting.delete');
  select * into v from public.gl_accounts where code = p_code for update;
  if v.code is null then
    perform private.raise_app_error('NOT_FOUND', 'account');
  end if;
  if private.system_account(p_code) then
    perform private.raise_app_error('CONFLICT', 'system_account');
  end if;
  if exists (select 1 from public.journal_lines where account = p_code)
     or exists (select 1 from public.money_movements where p_code in (debit_account, credit_account))
     or exists (select 1 from public.fixed_assets where p_code in (funded_from, disposal_account)) then
    update public.gl_accounts set active = false where code = p_code;
    perform private.audit('gl_account.deactivate', 'gl_accounts', p_code, to_jsonb(v), null);
    return 'deactivated';
  end if;
  delete from public.gl_accounts where code = p_code;
  perform private.audit('gl_account.delete', 'gl_accounts', p_code, to_jsonb(v), null);
  return 'deleted';
end;
$$;

/** Reverse a manual journal entry (once), dated today. */
create or replace function public.journal_reverse(p_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.journal_entries;
  v_new uuid;
begin
  perform private.assert_permission('accounting.cancel');
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  select * into v from public.journal_entries where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'journal');
  end if;
  if v.source <> 'manual' then
    perform private.raise_app_error('CONFLICT', 'not_manual');
  end if;
  if v.reversed_by is not null or v.reverses is not null then
    perform private.raise_app_error('CONFLICT', 'already_reversed');
  end if;
  v_new := private.post_journal(current_date, 'manual', null, 'Reversal of ' || v.number || ': ' || trim(p_reason),
    (select jsonb_agg(jsonb_build_object('account', l.account, 'debit', l.credit, 'credit', l.debit, 'district_id', l.district_id))
       from public.journal_lines l where l.entry_id = p_id));
  update public.journal_entries set reverses = p_id where id = v_new;
  update public.journal_entries set reversed_by = v_new where id = p_id;
  perform private.audit('journal.reverse', 'journal_entries', p_id::text, null, jsonb_build_object('reversal', v_new, 'reason', trim(p_reason)));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money movements: deposits, money out, other money in
-- ---------------------------------------------------------------------------
create table public.money_movements (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  kind              text not null check (kind in ('deposit', 'expense', 'income')),
  district_id       uuid references public.districts (id),
  movement_date     date not null,
  -- deposit: bank ← cash/mobile/card; expense: expense ← money account; income: money account ← income.
  debit_account     text not null references public.gl_accounts (code),
  credit_account    text not null references public.gl_accounts (code),
  amount            numeric(16, 2) not null check (amount > 0),
  party             text,
  reference         text,
  note              text,
  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  journal_id        uuid references public.journal_entries (id),
  cancel_journal_id uuid references public.journal_entries (id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references auth.users (id) on delete set null,
  decision_note     text,
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users (id) on delete set null,
  cancel_reason     text,
  check (debit_account <> credit_account)
);
create index money_movements_kind_idx on public.money_movements (kind, status, movement_date desc);
create index money_movements_district_idx on public.money_movements (district_id);
alter table public.money_movements enable row level security;
create policy money_movements_select on public.money_movements for select to authenticated
  using (public.has_permission('accounting.view') and (district_id is null or public.can_access_district(district_id)));

/** Balance of an account for a district (all districts when null) up to a date: debit-side for assets. */
create or replace function private.account_balance(p_account text, p_district uuid, p_to date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.debit - l.credit), 0)
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
  where l.account = p_account and e.entry_date <= p_to and (p_district is null or l.district_id = p_district);
$$;

/**
 * Record or change (while pending) a money movement. p: {kind, district_id, date, from_account, to_account,
 * account, amount, party, reference, note}.
 *   deposit: from_account (cash, mobile money or card — not a bank) → to_account (a bank); needs a district.
 *   expense: account (an expense account) paid from from_account (a money account).
 *   income:  account (income, equity or liability) received into to_account (a money account).
 */
create or replace function public.movement_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.money_movements;
  v_kind text := coalesce(p ->> 'kind', '');
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_date date;
  v_amount numeric;
  v_dr text;
  v_cr text;
  v_id uuid;
begin
  perform private.assert_permission('accounting.create');
  if p_id is not null then
    select * into v from public.money_movements where id = p_id for update;
    if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
      perform private.raise_app_error('NOT_FOUND', 'movement');
    end if;
    if v.status <> 'pending' then
      perform private.raise_app_error('CONFLICT', 'status');
    end if;
    v_kind := v.kind;
  end if;
  if v_kind not in ('deposit', 'expense', 'income') then
    perform private.raise_app_error('VALIDATION', 'kind');
  end if;
  begin
    v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
    v_amount := round((p ->> 'amount')::numeric, 2);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'amount');
  end;
  if v_amount is null or v_amount <= 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if v_date > current_date then
    perform private.raise_app_error('VALIDATION', 'date');
  end if;
  if v_district is not null and not public.can_access_district(v_district) then
    perform private.raise_app_error('VALIDATION', 'district_id');
  end if;

  if v_kind = 'deposit' then
    v_dr := p ->> 'to_account';
    v_cr := p ->> 'from_account';
    if v_district is null then
      perform private.raise_app_error('VALIDATION', 'district_id');
    end if;
    if not private.money_account(v_cr) or exists (select 1 from public.gl_accounts where code = v_cr and is_bank) then
      perform private.raise_app_error('VALIDATION', 'from_account');
    end if;
    if not exists (select 1 from public.gl_accounts where code = v_dr and is_bank and active) then
      perform private.raise_app_error('VALIDATION', 'to_account');
    end if;
  elsif v_kind = 'expense' then
    v_dr := p ->> 'account';
    v_cr := p ->> 'from_account';
    if not exists (select 1 from public.gl_accounts where code = v_dr and type = 'expense' and active) or v_dr in ('5100', '5300') then
      perform private.raise_app_error('VALIDATION', 'account');
    end if;
    if not private.money_account(v_cr) then
      perform private.raise_app_error('VALIDATION', 'from_account');
    end if;
  else
    v_dr := p ->> 'to_account';
    v_cr := p ->> 'account';
    if not exists (select 1 from public.gl_accounts where code = v_cr and type in ('income', 'equity', 'liability') and active)
       or v_cr in ('2100', '4100', '4110', '4200', '4300', '4400') then
      perform private.raise_app_error('VALIDATION', 'account');
    end if;
    if not private.money_account(v_dr) then
      perform private.raise_app_error('VALIDATION', 'to_account');
    end if;
  end if;

  if p_id is null then
    insert into public.money_movements (number, kind, district_id, movement_date, debit_account, credit_account, amount, party, reference, note, created_by)
    values (case v_kind when 'deposit' then 'DEP' when 'expense' then 'EXP' else 'INC' end || '-' || extract(year from v_date)::int || '-'
              || lpad(private.next_serial('MOV-' || v_kind || '-' || extract(year from v_date)::int)::text, 6, '0'),
            v_kind, v_district, v_date, v_dr, v_cr, v_amount, nullif(trim(p ->> 'party'), ''), nullif(trim(p ->> 'reference'), ''),
            nullif(trim(p ->> 'note'), ''), auth.uid())
    returning id into v_id;
    perform private.audit('movement.create', 'money_movements', v_id::text, null, p);
    return v_id;
  end if;
  update public.money_movements
     set district_id = v_district, movement_date = v_date, debit_account = v_dr, credit_account = v_cr, amount = v_amount,
         party = nullif(trim(p ->> 'party'), ''), reference = nullif(trim(p ->> 'reference'), ''), note = nullif(trim(p ->> 'note'), ''),
         status = 'pending', updated_at = now()
   where id = p_id;
  perform private.audit('movement.update', 'money_movements', p_id::text, to_jsonb(v), p);
  return p_id;
end;
$$;

/** Confirm (posts it) or reject (needs a note) a pending movement. A deposit can't take more than the district holds. */
create or replace function public.movement_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.money_movements;
  v_je uuid;
begin
  perform private.assert_permission('accounting.approve');
  select * into v from public.money_movements where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'movement');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 3 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.money_movements set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = trim(p_note), updated_at = now() where id = p_id;
    perform private.audit('movement.reject', 'money_movements', p_id::text, null, jsonb_build_object('note', trim(p_note)));
    return;
  end if;
  if v.kind = 'deposit' and private.account_balance(v.credit_account, v.district_id, current_date) < v.amount then
    perform private.raise_app_error('CONFLICT', 'insufficient');
  end if;
  v_je := private.post_journal(v.movement_date, 'movement', v.id,
    v.number || coalesce(' — ' || v.party, '') || coalesce(' (' || v.reference || ')', ''),
    jsonb_build_array(jsonb_build_object('account', v.debit_account, 'debit', v.amount, 'district_id', v.district_id),
                      jsonb_build_object('account', v.credit_account, 'credit', v.amount, 'district_id', v.district_id)));
  update public.money_movements set status = 'confirmed', journal_id = v_je, decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id;
  perform private.audit('movement.confirm', 'money_movements', p_id::text, null, jsonb_build_object('journal', v_je));
end;
$$;

/** Cancel a confirmed movement: a reversing entry dated today. */
create or replace function public.movement_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.money_movements;
  v_je uuid;
begin
  perform private.assert_permission('accounting.cancel');
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  select * into v from public.money_movements where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'movement');
  end if;
  if v.status <> 'confirmed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  v_je := private.post_journal(current_date, 'movement_cancel', v.id, 'Cancelled ' || v.number || ': ' || trim(p_reason),
    jsonb_build_array(jsonb_build_object('account', v.credit_account, 'debit', v.amount, 'district_id', v.district_id),
                      jsonb_build_object('account', v.debit_account, 'credit', v.amount, 'district_id', v.district_id)));
  update public.money_movements set status = 'cancelled', cancel_journal_id = v_je, cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = trim(p_reason), updated_at = now()
   where id = p_id;
  perform private.audit('movement.cancel', 'money_movements', p_id::text, null, jsonb_build_object('reason', trim(p_reason), 'journal', v_je));
end;
$$;

/** Delete a movement that never reached the books (pending or rejected). */
create or replace function public.movement_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.money_movements;
begin
  perform private.assert_permission('accounting.delete');
  select * into v from public.money_movements where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'movement');
  end if;
  if v.status not in ('pending', 'rejected') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  delete from public.money_movements where id = p_id;
  perform private.audit('movement.delete', 'money_movements', p_id::text, to_jsonb(v), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixed assets
-- ---------------------------------------------------------------------------
create table public.fixed_assets (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  name                text not null,
  category            text not null check (category in ('land', 'building', 'vehicle', 'equipment', 'computer', 'furniture', 'other')),
  district_id         uuid references public.districts (id),
  location            text,
  serial_no           text,
  acquired_on         date not null,
  cost                numeric(16, 2) not null check (cost >= 0),
  salvage_value       numeric(16, 2) not null default 0 check (salvage_value >= 0),
  useful_life_months  int not null default 0 check (useful_life_months between 0 and 1200),
  funded_from         text not null references public.gl_accounts (code),
  status              text not null default 'active' check (status in ('active', 'disposed')),
  disposed_on         date,
  disposal_amount     numeric(16, 2),
  disposal_account    text references public.gl_accounts (code),
  disposal_note       text,
  journal_id          uuid references public.journal_entries (id),
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  check (salvage_value <= cost)
);
create table public.asset_depreciation (
  asset_id    uuid not null references public.fixed_assets (id) on delete cascade,
  year        int not null,
  month       int not null check (month between 1 and 12),
  amount      numeric(16, 2) not null check (amount > 0),
  journal_id  uuid references public.journal_entries (id),
  created_at  timestamptz not null default now(),
  primary key (asset_id, year, month)
);
alter table public.fixed_assets enable row level security;
alter table public.asset_depreciation enable row level security;
create policy fixed_assets_select on public.fixed_assets for select to authenticated
  using (public.has_permission('accounting.view') and (district_id is null or public.can_access_district(district_id)));
create policy asset_depreciation_select on public.asset_depreciation for select to authenticated
  using (public.has_permission('accounting.view'));

/** Each asset with what has been written off so far and what it is still worth. */
create view public.fixed_assets_book with (security_invoker = true) as
  select a.*, coalesce(d.total, 0)::numeric(16, 2) as depreciated, (a.cost - coalesce(d.total, 0))::numeric(16, 2) as book_value, d.last_month
  from public.fixed_assets a
  left join lateral (select sum(amount) as total, max(make_date(year, month, 1)) as last_month from public.asset_depreciation where asset_id = a.id) d on true;
grant select on public.fixed_assets_book to authenticated;

/**
 * Add or change an asset. p: {name, category, district_id, location, serial_no, acquired_on, cost, salvage_value,
 * useful_life_months, funded_from, note}. Adding posts Dr Fixed assets / Cr funded_from (a money account, or 3100
 * for something the office already owned or was given). Cost, date and funding change only before depreciation.
 */
create or replace function public.asset_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fixed_assets;
  v_cost numeric;
  v_salvage numeric;
  v_life int;
  v_date date;
  v_from text := coalesce(nullif(p ->> 'funded_from', ''), '3100');
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_id uuid;
  v_je uuid;
begin
  perform private.assert_permission(case when p_id is null then 'accounting.create' else 'accounting.update' end);
  if length(trim(coalesce(p ->> 'name', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'name');
  end if;
  if coalesce(p ->> 'category', '') not in ('land', 'building', 'vehicle', 'equipment', 'computer', 'furniture', 'other') then
    perform private.raise_app_error('VALIDATION', 'category');
  end if;
  begin
    v_cost := round((p ->> 'cost')::numeric, 2);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'cost');
  end;
  if v_cost is null or v_cost < 0 then
    perform private.raise_app_error('VALIDATION', 'cost');
  end if;
  begin
    v_salvage := round(coalesce(nullif(p ->> 'salvage_value', '')::numeric, 0), 2);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'salvage_value');
  end;
  if v_salvage < 0 or v_salvage > v_cost then
    perform private.raise_app_error('VALIDATION', 'salvage_value');
  end if;
  begin
    v_life := coalesce(nullif(p ->> 'useful_life_months', '')::int, 0);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'useful_life_months');
  end;
  if v_life < 0 or v_life > 1200 then
    perform private.raise_app_error('VALIDATION', 'useful_life_months');
  end if;
  begin
    v_date := (p ->> 'acquired_on')::date;
  exception when others then
    perform private.raise_app_error('VALIDATION', 'acquired_on');
  end;
  if v_date is null or v_date > current_date then
    perform private.raise_app_error('VALIDATION', 'acquired_on');
  end if;
  if v_from <> '3100' and not private.money_account(v_from) then
    perform private.raise_app_error('VALIDATION', 'funded_from');
  end if;
  if v_district is not null and not public.can_access_district(v_district) then
    perform private.raise_app_error('VALIDATION', 'district_id');
  end if;

  if p_id is null then
    insert into public.fixed_assets (number, name, category, district_id, location, serial_no, acquired_on, cost, salvage_value,
                                     useful_life_months, funded_from, note, created_by)
    values ('FA-' || lpad(private.next_serial('FA')::text, 6, '0'), trim(p ->> 'name'), p ->> 'category', v_district,
            nullif(trim(p ->> 'location'), ''), nullif(trim(p ->> 'serial_no'), ''), v_date, v_cost, v_salvage, v_life, v_from,
            nullif(trim(p ->> 'note'), ''), auth.uid())
    returning * into v;
    v_je := private.post_journal(v_date, 'asset', v.id, v.number || ' — ' || v.name,
      jsonb_build_array(jsonb_build_object('account', '1500', 'debit', v_cost, 'district_id', v_district),
                        jsonb_build_object('account', v_from, 'credit', v_cost, 'district_id', v_district)));
    update public.fixed_assets set journal_id = v_je where id = v.id;
    perform private.audit('asset.create', 'fixed_assets', v.id::text, null, p);
    return v.id;
  end if;

  select * into v from public.fixed_assets where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'asset');
  end if;
  if v.status <> 'active' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if (v_cost <> v.cost or v_date <> v.acquired_on or v_from <> v.funded_from)
     and exists (select 1 from public.asset_depreciation where asset_id = p_id) then
    perform private.raise_app_error('CONFLICT', 'depreciated');
  end if;
  -- A new cost or funding account: take the old purchase out and put the new one in (zero lines drop out).
  if v_cost <> v.cost or v_from <> v.funded_from then
    perform private.post_journal(current_date, 'asset', v.id, v.number || ' corrected',
      jsonb_build_array(jsonb_build_object('account', v.funded_from, 'debit', v.cost, 'district_id', v.district_id),
                        jsonb_build_object('account', '1500', 'credit', v.cost, 'district_id', v.district_id),
                        jsonb_build_object('account', '1500', 'debit', v_cost, 'district_id', v_district),
                        jsonb_build_object('account', v_from, 'credit', v_cost, 'district_id', v_district)));
  end if;
  update public.fixed_assets
     set name = trim(p ->> 'name'), category = p ->> 'category', district_id = v_district, location = nullif(trim(p ->> 'location'), ''),
         serial_no = nullif(trim(p ->> 'serial_no'), ''), acquired_on = v_date, cost = v_cost, salvage_value = v_salvage,
         useful_life_months = v_life, funded_from = v_from, note = nullif(trim(p ->> 'note'), ''), updated_at = now()
   where id = p_id;
  perform private.audit('asset.update', 'fixed_assets', p_id::text, to_jsonb(v), p);
  return p_id;
end;
$$;

/**
 * Write off one month of depreciation for every active asset that has a useful life (straight line:
 * (cost − salvage) ÷ months, never below salvage). Months already done are skipped. One entry per run:
 * Dr Depreciation / Cr Accumulated depreciation. Returns {count, total}.
 */
create or replace function public.asset_depreciate(p_year int, p_month int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_count int;
  v_total numeric;
  v_je uuid;
begin
  perform private.assert_permission('accounting.approve');
  if p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    perform private.raise_app_error('VALIDATION', 'month');
  end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  if v_start > current_date then
    perform private.raise_app_error('VALIDATION', 'month');
  end if;

  create temporary table if not exists pg_temp.dep_run (asset_id uuid, district_id uuid, amount numeric) on commit drop;
  delete from pg_temp.dep_run;
  insert into pg_temp.dep_run
  select a.id, a.district_id,
         least(round((a.cost - a.salvage_value) / a.useful_life_months, 2), a.cost - a.salvage_value - coalesce(d.total, 0))
  from public.fixed_assets a
  left join lateral (select sum(amount) as total from public.asset_depreciation where asset_id = a.id) d on true
  where a.status = 'active' and a.useful_life_months > 0 and a.acquired_on <= v_end
    and (a.district_id is null or public.can_access_district(a.district_id))
    and not exists (select 1 from public.asset_depreciation x where x.asset_id = a.id and x.year = p_year and x.month = p_month)
    and a.cost - a.salvage_value - coalesce(d.total, 0) > 0;
  delete from pg_temp.dep_run where amount <= 0;
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from pg_temp.dep_run;
  if v_count = 0 then
    return jsonb_build_object('count', 0, 'total', 0);
  end if;

  v_je := private.post_journal(least(v_end, current_date), 'depreciation', null, 'Depreciation ' || to_char(v_start, 'YYYY-MM'),
    (select jsonb_agg(l) from (
       select jsonb_build_object('account', '5300', 'debit', sum(amount), 'district_id', district_id) l from pg_temp.dep_run group by district_id
       union all
       select jsonb_build_object('account', '1590', 'credit', sum(amount), 'district_id', district_id) from pg_temp.dep_run group by district_id) s));
  insert into public.asset_depreciation (asset_id, year, month, amount, journal_id)
  select asset_id, p_year, p_month, amount, v_je from pg_temp.dep_run;
  perform private.audit('asset.depreciate', 'asset_depreciation', to_char(v_start, 'YYYY-MM'), null, jsonb_build_object('count', v_count, 'total', v_total));
  return jsonb_build_object('count', v_count, 'total', v_total, 'journal_id', v_je);
end;
$$;

/**
 * Sell or write off an asset. p: {date, amount, account, note}: amount received (0 = written off) into a money
 * account. Clears the cost and its depreciation; the difference is a gain or loss (4400).
 */
create or replace function public.asset_dispose(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fixed_assets;
  v_date date;
  v_amount numeric;
  v_account text := nullif(p ->> 'account', '');
  v_dep numeric;
  v_gain numeric;
  v_je uuid;
begin
  perform private.assert_permission('accounting.approve');
  select * into v from public.fixed_assets where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'asset');
  end if;
  if v.status <> 'active' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  begin
    v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
    v_amount := round(coalesce(nullif(p ->> 'amount', '')::numeric, 0), 2);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'amount');
  end;
  if v_amount < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if v_date > current_date or v_date < v.acquired_on then
    perform private.raise_app_error('VALIDATION', 'date');
  end if;
  if v_amount > 0 and not private.money_account(v_account) then
    perform private.raise_app_error('VALIDATION', 'account');
  end if;
  select coalesce(sum(amount), 0) into v_dep from public.asset_depreciation where asset_id = p_id;
  v_gain := v_amount + v_dep - v.cost;
  v_je := private.post_journal(v_date, 'disposal', v.id, v.number || ' disposed — ' || v.name,
    jsonb_build_array(jsonb_build_object('account', '1590', 'debit', v_dep, 'district_id', v.district_id),
                      jsonb_build_object('account', coalesce(v_account, '1100'), 'debit', v_amount, 'district_id', v.district_id),
                      jsonb_build_object('account', '1500', 'credit', v.cost, 'district_id', v.district_id),
                      jsonb_build_object('account', '4400', 'credit', greatest(v_gain, 0), 'district_id', v.district_id),
                      jsonb_build_object('account', '4400', 'debit', greatest(-v_gain, 0), 'district_id', v.district_id)));
  update public.fixed_assets set status = 'disposed', disposed_on = v_date, disposal_amount = v_amount,
         disposal_account = case when v_amount > 0 then v_account end, disposal_note = nullif(trim(p ->> 'note'), ''), updated_at = now()
   where id = p_id;
  perform private.audit('asset.dispose', 'fixed_assets', p_id::text, to_jsonb(v), p || jsonb_build_object('journal', v_je, 'gain', v_gain));
end;
$$;

/** Delete an asset added by mistake (no depreciation yet): its purchase entry is reversed. */
create or replace function public.asset_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fixed_assets;
begin
  perform private.assert_permission('accounting.delete');
  select * into v from public.fixed_assets where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'asset');
  end if;
  if v.status <> 'active' or exists (select 1 from public.asset_depreciation where asset_id = p_id) then
    perform private.raise_app_error('CONFLICT', 'depreciated');
  end if;
  perform private.post_journal(current_date, 'asset_cancel', v.id, v.number || ' deleted — ' || v.name,
    jsonb_build_array(jsonb_build_object('account', v.funded_from, 'debit', v.cost, 'district_id', v.district_id),
                      jsonb_build_object('account', '1500', 'credit', v.cost, 'district_id', v.district_id)));
  delete from public.fixed_assets where id = p_id;
  perform private.audit('asset.delete', 'fixed_assets', p_id::text, to_jsonb(v), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
/**
 * The Accounting overview for [p_from, p_to]: money account and other balances at p_to, money in (collections +
 * other income) and out (expenses), deposits, a daily series, collections by channel, what waits for
 * confirmation and the assets.
 */
create or replace function public.accounting_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := least(p_from, p_to);
  v_to date := greatest(p_from, p_to);
begin
  perform private.assert_permission('accounting.view');
  if v_to - v_from > 731 then
    v_from := v_to - 731;
  end if;
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'balances', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name_so', a.name_so, 'name_en', a.name_en, 'type', a.type, 'is_bank', a.is_bank,
                 'balance', case when a.type in ('asset', 'expense') then b.dr - b.cr else b.cr - b.dr end) order by a.code), '[]'::jsonb)
      from public.gl_accounts a
      cross join lateral (select coalesce(sum(l.debit), 0) dr, coalesce(sum(l.credit), 0) cr
                            from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                           where l.account = a.code and e.entry_date <= v_to) b
      where a.type in ('asset', 'liability', 'equity') and (a.active or b.dr <> b.cr)),
    'collected', (select coalesce(sum(amount_base), 0) from public.payments where status <> 'reversed' and received_at::date between v_from and v_to),
    'other_in', (select coalesce(sum(amount), 0) from public.money_movements where kind = 'income' and status = 'confirmed' and movement_date between v_from and v_to),
    'money_out', (select coalesce(sum(amount), 0) from public.money_movements where kind = 'expense' and status = 'confirmed' and movement_date between v_from and v_to),
    'deposited', (select coalesce(sum(amount), 0) from public.money_movements where kind = 'deposit' and status = 'confirmed' and movement_date between v_from and v_to),
    'billed', (select coalesce(sum(total), 0) from public.invoices where status <> 'cancelled' and issue_date between v_from and v_to),
    'income', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                join public.gl_accounts a on a.code = l.account where a.type = 'income' and e.entry_date between v_from and v_to),
    'expenses', (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                  join public.gl_accounts a on a.code = l.account where a.type = 'expense' and e.entry_date between v_from and v_to),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
               'in', coalesce((select sum(amount_base) from public.payments where status <> 'reversed' and received_at::date = d::date), 0)
                     + coalesce((select sum(amount) from public.money_movements where kind = 'income' and status = 'confirmed' and movement_date = d::date), 0),
               'out', coalesce((select sum(amount) from public.money_movements where kind = 'expense' and status = 'confirmed' and movement_date = d::date), 0))
             order by d), '[]'::jsonb)
      from generate_series(v_from, v_to, interval '1 day') d),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('channel', c, 'amount', s) order by s desc), '[]'::jsonb)
      from (select private.collection_channel(method, wallet) c, sum(amount_base) s from public.payments
             where status <> 'reversed' and received_at::date between v_from and v_to group by 1) x),
    'expense_by_account', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name_so', a.name_so, 'name_en', a.name_en, 'amount', s) order by s desc), '[]'::jsonb)
      from (select debit_account code, sum(amount) s from public.money_movements
             where kind = 'expense' and status = 'confirmed' and movement_date between v_from and v_to group by 1) x
      join public.gl_accounts a on a.code = x.code),
    'pending', (
      select coalesce(jsonb_object_agg(kind, jsonb_build_object('count', n, 'amount', s)), '{}'::jsonb)
      from (select kind, count(*) n, sum(amount) s from public.money_movements
             where status = 'pending' and (district_id is null or public.can_access_district(district_id)) group by kind) x),
    'assets', (
      select jsonb_build_object('count', count(*) filter (where a.status = 'active'),
               'cost', coalesce(sum(a.cost) filter (where a.status = 'active'), 0),
               'book_value', coalesce(sum(a.cost - coalesce(d.total, 0)) filter (where a.status = 'active'), 0),
               'due', count(*) filter (where a.status = 'active' and a.useful_life_months > 0 and a.cost - a.salvage_value - coalesce(d.total, 0) > 0
                                       and not exists (select 1 from public.asset_depreciation x where x.asset_id = a.id
                                                        and make_date(x.year, x.month, 1) = date_trunc('month', current_date - interval '1 month')::date)
                                       and a.acquired_on < date_trunc('month', current_date)::date))
      from public.fixed_assets a
      left join lateral (select sum(amount) total from public.asset_depreciation where asset_id = a.id) d on true
      where a.district_id is null or public.can_access_district(a.district_id))
  );
end;
$$;

/**
 * Collections from each district the viewer may see, for [p_from, p_to]: billed, collected (and by cash, mobile
 * money, card, bank transfer), deposited to the bank, what the district still holds (cash, mobile money and card
 * not yet deposited, at p_to) and what is still owed on open invoices today.
 */
create or replace function public.accounting_districts(p_from date, p_to date)
returns table (district_id uuid, code text, name_so text, name_en text, billed numeric, collected numeric, cash numeric, mobile numeric,
               card numeric, bank numeric, deposited numeric, held numeric, owed numeric, pending_deposits numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_permission('accounting.view');
  return query
  select d.id, d.code, d.name_so, d.name_en,
         coalesce((select sum(i.total) from public.invoices i where i.district_id = d.id and i.status <> 'cancelled' and i.issue_date between p_from and p_to), 0),
         coalesce(p.total, 0), coalesce(p.cash, 0), coalesce(p.mobile, 0), coalesce(p.card, 0), coalesce(p.bank, 0),
         coalesce((select sum(m.amount) from public.money_movements m where m.district_id = d.id and m.kind = 'deposit' and m.status = 'confirmed'
                    and m.movement_date between p_from and p_to), 0),
         coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                    join public.gl_accounts a on a.code = l.account
                   where l.district_id = d.id and a.type = 'asset' and a.code like '11__' and not a.is_bank and e.entry_date <= p_to), 0),
         coalesce((select sum(i.balance) from public.invoices i where i.district_id = d.id and i.status in ('issued', 'partially_paid')), 0),
         coalesce((select sum(m.amount) from public.money_movements m where m.district_id = d.id and m.kind = 'deposit' and m.status = 'pending'), 0)
  from public.districts d
  left join lateral (
    select sum(x.amount_base) total,
           sum(x.amount_base) filter (where x.method in ('cash', 'cheque')) cash,
           sum(x.amount_base) filter (where x.method = 'mobile_money') mobile,
           sum(x.amount_base) filter (where x.method = 'card') card,
           sum(x.amount_base) filter (where x.method = 'bank_transfer') bank
    from public.payments x where x.district_id = d.id and x.status <> 'reversed' and x.received_at::date between p_from and p_to) p on true
  where public.can_access_district(d.id)
  order by coalesce(p.total, 0) desc, d.code;
end;
$$;

revoke all on function private.system_account(text), private.money_account(text), private.account_balance(text, uuid, date) from public, anon, authenticated;
revoke all on function public.gl_account_save(jsonb), public.gl_account_delete(text), public.journal_reverse(uuid, text),
  public.movement_save(uuid, jsonb), public.movement_decide(uuid, boolean, text), public.movement_cancel(uuid, text), public.movement_delete(uuid),
  public.asset_save(uuid, jsonb), public.asset_depreciate(int, int), public.asset_dispose(uuid, jsonb), public.asset_delete(uuid),
  public.accounting_overview(date, date), public.accounting_districts(date, date) from public, anon;
grant execute on function public.gl_account_save(jsonb), public.gl_account_delete(text), public.journal_reverse(uuid, text),
  public.movement_save(uuid, jsonb), public.movement_decide(uuid, boolean, text), public.movement_cancel(uuid, text), public.movement_delete(uuid),
  public.asset_save(uuid, jsonb), public.asset_depreciate(int, int), public.asset_dispose(uuid, jsonb), public.asset_delete(uuid),
  public.accounting_overview(date, date), public.accounting_districts(date, date) to authenticated;
