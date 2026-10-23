-- Collections, stage 2: every payment is Pending until a finance officer checks it against the money, then
-- Verified (or Disputed, with a reason); an approved cashier reconciliation (stage 3) makes it Reconciled.
-- Mistakes in how a payment was recorded (way of paying, wallet, reference, payer) are corrected by request:
-- a reason, then a Finance Manager's approval; the payment keeps its original values in the correction record and
-- the audit log. A wrong amount is still fixed by a reversal and a new payment, as before.

alter table public.payments
  add column if not exists verify_status text not null default 'pending' check (verify_status in ('pending', 'verified', 'reconciled', 'disputed')),
  add column if not exists verified_by uuid references auth.users (id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists dispute_reason text;
create index if not exists payments_verify_idx on public.payments (verify_status, received_at desc);
create index if not exists payments_created_by_idx on public.payments (created_by);
create index if not exists payments_verified_by_idx on public.payments (verified_by);

-- Corrections that move money between cash and a clearing account post their own journal entry.
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('invoice', 'invoice_cancel', 'payment', 'reversal', 'manual', 'payment_correction'));

/** Finance officer: mark payments as checked against the money (cash counted, statement line seen). */
create or replace function public.payment_verify(p_ids uuid[], p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  n int := 0;
begin
  perform private.assert_permission('reconciliation.update');
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    perform private.raise_app_error('VALIDATION', 'ids');
  end if;
  for v in select * from public.payments where id = any (p_ids) order by received_at for update loop
    if not private.can_view_payment(v.district_id, v.parcel_id) then
      perform private.raise_app_error('NOT_FOUND', 'payment');
    end if;
    if v.status = 'reversed' or v.verify_status = 'reconciled' then
      perform private.raise_app_error('CONFLICT', 'not_verifiable');
    end if;
    -- A cashier never checks their own takings.
    perform private.assert_maker_checker(v.created_by);
    if v.verify_status = 'disputed' and coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    if v.verify_status <> 'verified' then
      update public.payments set verify_status = 'verified', verified_by = auth.uid(), verified_at = now(),
             dispute_reason = case when v.verify_status = 'disputed' then dispute_reason || ' — ' || trim(p_note) else dispute_reason end
       where id = v.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

/** Finance officer: the money doesn't match (not on the statement, wrong amount, cash short …). */
create or replace function public.payment_dispute(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
begin
  perform private.assert_permission('reconciliation.update');
  if length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  select * into v from public.payments where id = p_id for update;
  if v.id is null or not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'payment');
  end if;
  if v.status = 'reversed' or v.verify_status = 'reconciled' then
    perform private.raise_app_error('CONFLICT', 'not_verifiable');
  end if;
  update public.payments set verify_status = 'disputed', dispute_reason = trim(p_reason), verified_by = auth.uid(), verified_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
create table if not exists public.payment_corrections (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  payment_id     uuid not null references public.payments (id),
  before         jsonb not null,
  changes        jsonb not null,
  reason         text not null check (length(trim(reason)) >= 5),
  status         public.decision_status not null default 'pending',
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text
);
create unique index if not exists payment_corrections_pending_uidx on public.payment_corrections (payment_id) where status = 'pending';
create index if not exists payment_corrections_requested_by_idx on public.payment_corrections (requested_by);
create index if not exists payment_corrections_decided_by_idx on public.payment_corrections (decided_by);
alter table public.payment_corrections enable row level security;
revoke all on public.payment_corrections from anon;
revoke insert, update, delete on public.payment_corrections from authenticated;
create policy payment_corrections_select on public.payment_corrections for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and private.can_view_payment(p.district_id, p.parcel_id)));
create trigger audit after insert or update or delete on public.payment_corrections for each row execute function private.audit_row();

/**
 * Ask to correct how a payment was recorded. p_changes: any of {method, wallet, reference, payer_name, payer_phone}.
 * The cashier who took it or a finance officer; one open request per payment; reconciled payments are closed.
 */
create or replace function public.payment_correction_request(p_payment uuid, p_changes jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_changes jsonb := '{}'::jsonb;
  v_method text;
  v_wallet text;
  v_ref text;
  v_id uuid;
  k text;
begin
  select * into v from public.payments where id = p_payment;
  if v.id is null or not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'payment');
  end if;
  if not ((v.created_by = auth.uid() and public.has_permission('payments.create')) or public.has_permission('reconciliation.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.update');
  end if;
  if v.status = 'reversed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.verify_status = 'reconciled' then
    perform private.raise_app_error('CONFLICT', 'reconciled');
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if jsonb_typeof(p_changes) <> 'object' then
    perform private.raise_app_error('VALIDATION', 'changes');
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('method', 'wallet', 'reference', 'payer_name', 'payer_phone') then
      perform private.raise_app_error('VALIDATION', 'changes');
    end if;
  end loop;
  -- Keep only what really changes.
  v_method := coalesce(nullif(p_changes ->> 'method', ''), v.method::text);
  v_wallet := case when v_method = 'mobile_money' then coalesce(nullif(p_changes ->> 'wallet', ''), case when p_changes ? 'method' then null else v.wallet end) end;
  v_ref := case when p_changes ? 'reference' then nullif(trim(p_changes ->> 'reference'), '') else v.reference end;
  if v_method not in ('cash', 'cheque', 'mobile_money', 'bank_transfer', 'card') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  if (v.method = 'card') <> (v_method = 'card') then
    -- Card payments come from the card processor; they can't become desk money or the other way round.
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  if v_method = 'mobile_money' and coalesce(v_wallet, '') not in ('evc_plus', 'edahab', 'zaad') then
    perform private.raise_app_error('VALIDATION', 'wallet');
  end if;
  if v_method in ('mobile_money', 'bank_transfer') and v_ref is null and v.provider_ref is null then
    perform private.raise_app_error('VALIDATION', 'reference_required');
  end if;
  if v_ref is not null and exists (
       select 1 from public.payments where id <> v.id and method::text = v_method and coalesce(wallet, '') = coalesce(v_wallet, '')
          and upper(reference) = upper(v_ref) and status <> 'reversed') then
    perform private.raise_app_error('CONFLICT', 'duplicate_reference');
  end if;
  if v_method <> v.method::text then v_changes := v_changes || jsonb_build_object('method', v_method); end if;
  if coalesce(v_wallet, '') <> coalesce(v.wallet, '') then v_changes := v_changes || jsonb_build_object('wallet', v_wallet); end if;
  if coalesce(v_ref, '') <> coalesce(v.reference, '') then v_changes := v_changes || jsonb_build_object('reference', v_ref); end if;
  if p_changes ? 'payer_name' and coalesce(nullif(trim(p_changes ->> 'payer_name'), ''), '') <> coalesce(v.payer_name, '') then
    v_changes := v_changes || jsonb_build_object('payer_name', nullif(trim(p_changes ->> 'payer_name'), ''));
  end if;
  if p_changes ? 'payer_phone' and coalesce(nullif(trim(p_changes ->> 'payer_phone'), ''), '') <> coalesce(v.payer_phone, '') then
    v_changes := v_changes || jsonb_build_object('payer_phone', nullif(trim(p_changes ->> 'payer_phone'), ''));
  end if;
  if v_changes = '{}'::jsonb then
    perform private.raise_app_error('VALIDATION', 'no_change');
  end if;
  insert into public.payment_corrections (number, payment_id, before, changes, reason, requested_by)
  values ('COR-' || lpad(private.next_serial('COR')::text, 5, '0'), v.id,
          jsonb_build_object('method', v.method, 'wallet', v.wallet, 'reference', v.reference, 'payer_name', v.payer_name, 'payer_phone', v.payer_phone),
          v_changes, trim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'correction_pending');
end;
$$;

/** Finance Manager: approve (apply) or reject a correction. Another person than the one who asked. */
create or replace function public.payment_correction_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.payment_corrections;
  v public.payments;
  v_method public.payment_method;
  v_old text;
  v_new text;
begin
  perform private.assert_permission('payments.approve');
  select * into c from public.payment_corrections where id = p_id for update;
  if c.id is null then
    perform private.raise_app_error('NOT_FOUND', 'correction');
  end if;
  select * into v from public.payments where id = c.payment_id for update;
  if not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'correction');
  end if;
  if c.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(c.requested_by);
  if not p_approve then
    if length(coalesce(trim(p_note), '')) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.payment_corrections set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    return;
  end if;
  if v.status = 'reversed' or v.verify_status = 'reconciled' then
    perform private.raise_app_error('CONFLICT', 'reconciled');
  end if;
  v_method := coalesce(c.changes ->> 'method', v.method::text)::public.payment_method;
  -- Moving between cash and a clearing account moves the money in the ledger too.
  v_old := private.clearing_account(v.method);
  v_new := private.clearing_account(v_method);
  if v_old <> v_new then
    perform private.post_journal(current_date, 'payment_correction', v.id, 'Correction ' || c.number || ' of ' || v.receipt_no,
      jsonb_build_array(jsonb_build_object('account', v_new, 'debit', v.amount_base, 'district_id', v.district_id),
                        jsonb_build_object('account', v_old, 'credit', v.amount_base, 'district_id', v.district_id)));
  end if;
  update public.payments
     set method = v_method,
         wallet = case when v_method = 'mobile_money' then (case when c.changes ? 'wallet' then c.changes ->> 'wallet' else wallet end) end,
         provider = case when v.provider in ('cash', 'bank', 'evc_plus', 'edahab', 'zaad') or v.provider is null then
                      case v_method when 'cash' then 'cash' when 'cheque' then 'cash' when 'bank_transfer' then 'bank'
                                    when 'mobile_money' then (case when c.changes ? 'wallet' then c.changes ->> 'wallet' else wallet end) else provider end
                      else provider end,
         reference = case when c.changes ? 'reference' then c.changes ->> 'reference' else reference end,
         payer_name = case when c.changes ? 'payer_name' then c.changes ->> 'payer_name' else payer_name end,
         payer_phone = case when c.changes ? 'payer_phone' then c.changes ->> 'payer_phone' else payer_phone end,
         -- Checked again after a correction.
         verify_status = 'pending', verified_by = null, verified_at = null
   where id = v.id;
  update public.payment_corrections set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  if v.parcel_id is not null then
    perform private.parcel_event(v.parcel_id, 'payment_corrected', c.reason, jsonb_build_object('payment_id', v.id, 'correction', c.number, 'changes', c.changes));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The verification queue
-- ---------------------------------------------------------------------------
/** Payments to check, with the cashier, the column they fall in, what was owed and how much evidence there is. */
create or replace function public.collections_queue(p_status text, p_from date, p_to date, p_cashier uuid default null, p_district uuid default null)
returns table (payment_id uuid, receipt_no text, received_at timestamptz, method text, wallet text, channel text, reference text,
               amount numeric, expected_amount numeric, pun text, payer text, cashier_id uuid, cashier text, district_so text, district_en text,
               verify_status text, dispute_reason text, verified_by text, evidence bigint, correction_pending boolean)
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
  if p_status is not null and p_status not in ('pending', 'verified', 'reconciled', 'disputed') then
    perform private.raise_app_error('VALIDATION', 'status');
  end if;
  return query
    select p.id, p.receipt_no, p.received_at, p.method::text, p.wallet, private.collection_channel(p.method, p.wallet), coalesce(p.reference, p.provider_ref),
           p.amount_base, p.expected_amount, pa.pun, p.payer_name, p.created_by, pr.full_name, d.name_so, d.name_en,
           p.verify_status, p.dispute_reason, vb.full_name,
           (select count(*) from public.payment_evidence e where e.payment_id = p.id),
           exists (select 1 from public.payment_corrections c where c.payment_id = p.id and c.status = 'pending')
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.profiles pr on pr.user_id = p.created_by
      left join public.profiles vb on vb.user_id = p.verified_by
      left join public.districts d on d.id = p.district_id
     where p.status <> 'reversed' and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
       and (p_status is null or p.verify_status = p_status)
       and (p_cashier is null or p.created_by = p_cashier)
       and (p_district is null or p.district_id = p_district)
     order by p.received_at desc
     limit 2000;
end;
$$;

revoke all on function public.payment_verify(uuid[], text), public.payment_dispute(uuid, text),
  public.payment_correction_request(uuid, jsonb, text), public.payment_correction_decide(uuid, boolean, text),
  public.collections_queue(text, date, date, uuid, uuid) from public, anon;
grant execute on function public.payment_verify(uuid[], text), public.payment_dispute(uuid, text),
  public.payment_correction_request(uuid, jsonb, text), public.payment_correction_decide(uuid, boolean, text),
  public.collections_queue(text, date, date, uuid, uuid) to authenticated;
