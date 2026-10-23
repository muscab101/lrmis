-- Collections, stage 1: which mobile wallet (EVC Plus, eDahab, ZAAD), what the payer owed, proof of payment,
-- and duplicate checks.
--
-- * Mobile money now names its wallet, so every report can split Cash / EVC Plus / eDahab / ZAAD / Bank.
--   Cashiers can take mobile money at the desk (wallet and transaction reference required).
-- * expected_amount: what the payer owed on the bill(s) when they paid, so over- and underpayments show.
-- * A transaction reference can be used once per way of paying; the same parcel paying the same amount at the
--   desk within 10 minutes needs a confirmation (likely a double entry).
-- * Evidence: a receipt photo, a statement page or an SMS screenshot kept with the payment (private bucket).

alter table public.payments
  add column if not exists wallet text check (wallet in ('evc_plus', 'edahab', 'zaad', 'sahal', 'other_wallet')),
  add column if not exists expected_amount numeric(14, 2);
alter table public.payments add constraint payments_wallet_mobile check (wallet is null or method = 'mobile_money');

-- Wallets paid at the desk (to the district's merchant number); not online checkouts, so they stay "off" here.
insert into public.payment_providers (code, name, method, enabled, sort) values
  ('evc_plus', 'EVC Plus (Hormuud)', 'mobile_money', false, 11),
  ('edahab', 'eDahab (Somtel)', 'mobile_money', false, 12),
  ('zaad', 'ZAAD (Telesom)', 'mobile_money', false, 13)
on conflict (code) do nothing;

/** The column a payment falls in on every collections report. */
create or replace function private.collection_channel(p_method public.payment_method, p_wallet text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_method = 'cash' then 'cash'
           when p_method = 'mobile_money' and p_wallet in ('evc_plus', 'edahab', 'zaad') then p_wallet
           when p_method = 'bank_transfer' then 'bank_transfer'
           when p_method = 'card' then 'card'
           else 'other' end;
$$;

-- One use per transaction reference for each way of paying (reversed payments free it again).
create unique index if not exists payments_reference_uidx
  on public.payments (method, coalesce(wallet, ''), upper(reference)) where reference is not null and status <> 'reversed';

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
  v_wallet text := case when (p ->> 'method') = 'mobile_money' then nullif(p ->> 'wallet', '') end;
  v_reference text := nullif(trim(p ->> 'reference'), '');
  v_expected numeric;
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
  if v_reference is not null and exists (
       select 1 from public.payments where method = v_method and coalesce(wallet, '') = coalesce(v_wallet, '')
          and upper(reference) = upper(v_reference) and status <> 'reversed') then
    perform private.raise_app_error('CONFLICT', 'duplicate_reference');
  end if;
  -- What was owed: the chosen bill, or everything open on the parcel.
  if v_parcel.id is not null then
    select coalesce(sum(i.balance), 0) into v_expected from public.invoices i
     where i.parcel_id = v_parcel.id and i.status in ('issued', 'partially_paid')
       and (nullif(p ->> 'invoice_id', '') is null or i.id = (p ->> 'invoice_id')::uuid);
  elsif nullif(p ->> 'invoice_id', '') is not null then
    select balance into v_expected from public.invoices where id = (p ->> 'invoice_id')::uuid;
  end if;
  v_rate := private.fx_rate_for(v_currency, v_received::date);
  v_base := round(v_amount / v_rate, 2);
  select * into v_pos from public.points_of_sale where id = coalesce(nullif(p ->> 'pos_id', '')::uuid, (select id from public.points_of_sale where code = 'ONLINE'));
  v_receipt := v_pos.receipt_prefix || '-' || extract(year from v_received)::int || '-' || lpad(private.next_serial('RCP-' || v_pos.code || '-' || extract(year from v_received)::int)::text, 6, '0');

  insert into public.payments (receipt_no, parcel_id, district_id, method, wallet, provider, provider_ref, reference, currency, fx_rate, amount, amount_base,
                               unallocated, status, received_at, pos_id, shift_id, intent_id, payer_name, payer_phone, note, expected_amount, created_by)
  values (v_receipt, v_parcel.id, v_parcel.district_id, v_method, v_wallet, nullif(p ->> 'provider', ''), nullif(p ->> 'provider_ref', ''), v_reference,
          v_currency, v_rate, v_amount, v_base, v_base, case when v_parcel.id is null then 'unmatched'::public.payment_status else 'completed'::public.payment_status end,
          v_received, v_pos.id, nullif(p ->> 'shift_id', '')::uuid, nullif(p ->> 'intent_id', '')::uuid, nullif(trim(p ->> 'payer_name'), ''),
          nullif(trim(p ->> 'payer_phone'), ''), nullif(trim(p ->> 'note'), ''), v_expected, auth.uid())
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

/**
 * Cashier takes a payment in their open shift.
 * p: {parcel_id, invoice_id?, amount, currency, method, wallet?, payer_name, payer_phone, reference, note, confirm_duplicate?}.
 * Mobile money needs the wallet and the transaction reference; a bank transfer needs its reference.
 */
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
  v_wallet text := nullif(p ->> 'wallet', '');
begin
  perform private.assert_permission('payments.create');
  select * into v_s from public.cashier_shifts where id = p_shift for update;
  if v_s.id is null or v_s.cashier_id <> auth.uid() or v_s.status <> 'open' then
    perform private.raise_app_error('CONFLICT', 'shift_not_open');
  end if;
  if v_method not in ('cash', 'cheque', 'bank_transfer', 'mobile_money') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  if v_method = 'mobile_money' and coalesce(v_wallet, '') not in ('evc_plus', 'edahab', 'zaad') then
    perform private.raise_app_error('VALIDATION', 'wallet');
  end if;
  if v_method in ('mobile_money', 'bank_transfer') and coalesce(trim(p ->> 'reference'), '') = '' then
    perform private.raise_app_error('VALIDATION', 'reference_required');
  end if;
  select * into v_parcel from public.parcels where id = nullif(p ->> 'parcel_id', '')::uuid and deleted_at is null;
  if v_parcel.id is null or not public.can_access_district(v_parcel.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  -- The same parcel paying the same amount moments ago is most likely a double entry.
  if coalesce((p ->> 'confirm_duplicate')::boolean, false) is false and exists (
       select 1 from public.payments where parcel_id = v_parcel.id and status <> 'reversed'
          and amount = round((p ->> 'amount')::numeric, 2) and received_at > now() - interval '10 minutes') then
    perform private.raise_app_error('CONFLICT', 'possible_duplicate');
  end if;
  return private.record_payment(p || jsonb_build_object(
    'method', v_method,
    'wallet', case when v_method = 'mobile_money' then v_wallet end,
    'provider', case when v_method = 'bank_transfer' then 'bank' when v_method = 'mobile_money' then v_wallet else 'cash' end,
    'pos_id', v_s.pos_id, 'shift_id', v_s.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('payment-evidence', 'payment-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

create table if not exists public.payment_evidence (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments (id),
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text not null,
  note          text,
  uploaded_by   uuid references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists payment_evidence_payment_idx on public.payment_evidence (payment_id);
create index if not exists payment_evidence_uploaded_by_idx on public.payment_evidence (uploaded_by);
alter table public.payment_evidence enable row level security;
revoke all on public.payment_evidence from anon;
revoke insert, update, delete on public.payment_evidence from authenticated;
create policy payment_evidence_select on public.payment_evidence for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and private.can_view_payment(p.district_id, p.parcel_id)));
create trigger audit after insert or update or delete on public.payment_evidence for each row execute function private.audit_row();

/** Keep a file (already uploaded by the server) with a payment. The cashier who took it or finance staff. */
create or replace function public.payment_add_evidence(p_payment uuid, p_path text, p_name text, p_type text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_id uuid;
begin
  select * into v from public.payments where id = p_payment;
  if v.id is null or not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'payment');
  end if;
  if not ((v.created_by = auth.uid() and public.has_permission('payments.create'))
          or public.has_permission('reconciliation.update') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'payments.create');
  end if;
  if p_path is null or p_path !~ ('^' || p_payment::text || '/[0-9a-f-]{36}\.(jpeg|png|webp|pdf)$') then
    perform private.raise_app_error('VALIDATION', 'path');
  end if;
  if p_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    perform private.raise_app_error('VALIDATION', 'type');
  end if;
  insert into public.payment_evidence (payment_id, storage_path, file_name, content_type, note, uploaded_by)
  values (p_payment, p_path, left(coalesce(nullif(trim(p_name), ''), 'file'), 200), p_type, nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Duplicates
-- ---------------------------------------------------------------------------
/**
 * Payments that look like the same money recorded twice, in a period:
 * same_reference — one transaction reference on more than one payment (any way of paying);
 * same_amount    — the same parcel (or payer phone) paying the same amount on the same day.
 */
create or replace function public.payment_duplicates(p_from date, p_to date)
returns table (kind text, key text, payment_id uuid, receipt_no text, received_at timestamptz, method text, wallet text,
               reference text, amount numeric, pun text, payer text, cashier text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  perform private.assert_report(p_from, p_to);
  return query
    with pm as (
      select p.*, coalesce(p.parcel_id::text, nullif(p.payer_phone, '')) who
        from public.payments p
       where p.status <> 'reversed' and p.received_at >= p_from and p.received_at < p_to + 1
         and private.can_view_payment(p.district_id, p.parcel_id)
    ), dup as (
      select 'same_reference'::text kind, upper(pm.reference) k, pm.id from pm
       where pm.reference is not null
         and (select count(*) from pm b where upper(b.reference) = upper(pm.reference)) > 1
      union all
      select 'same_amount', pm.who || '|' || pm.amount || '|' || pm.received_at::date, pm.id from pm
       where pm.who is not null
         and (select count(*) from pm b where b.who = pm.who and b.amount = pm.amount and b.received_at::date = pm.received_at::date) > 1
    )
    select d.kind, d.k, p.id, p.receipt_no, p.received_at, p.method::text, p.wallet, p.reference, p.amount, pa.pun,
           p.payer_name, pr.full_name, p.status::text
      from dup d
      join public.payments p on p.id = d.id
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.profiles pr on pr.user_id = p.created_by
     order by d.kind, d.k, p.received_at;
end;
$$;

revoke all on function private.collection_channel(public.payment_method, text) from public, anon, authenticated;
revoke all on function public.payment_add_evidence(uuid, text, text, text, text), public.payment_duplicates(date, date) from public, anon;
grant execute on function public.payment_add_evidence(uuid, text, text, text, text), public.payment_duplicates(date, date) to authenticated;

-- The Revenue Auditor / Finance Officer verifies and reconciles collections (it could only look before).
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['reconciliation.create', 'reconciliation.update']) k
 where r.key = 'auditor'
on conflict do nothing;
