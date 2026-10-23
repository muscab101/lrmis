-- Collections, stage 3: reconcile each cashier's day. For every way of paying (cash, EVC Plus, eDahab, ZAAD,
-- bank transfer, card, other) the finance officer enters what actually came in (cash counted, the wallet and bank
-- statement totals) against what the cashier recorded. The system works out:
--   difference = actual − recorded;  shortage = recorded − actual when positive;  excess = actual − recorded when positive.
-- A Finance Manager approves it (not the officer who prepared it, not the cashier); approval marks the day's payments
-- Reconciled (disputed ones stay disputed). A rejected reconciliation can be prepared again.
--
-- Statement uploads (Payments → Reconciliation) now also match desk payments by their transaction reference, and a
-- statement line that matches marks a pending payment Verified.

create table if not exists public.cashier_reconciliations (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  cashier_id     uuid not null references auth.users (id),
  district_id    uuid references public.districts (id),
  business_date  date not null,
  status         text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  recorded       numeric(14, 2) not null,
  actual         numeric(14, 2) not null,
  difference     numeric(14, 2) generated always as (actual - recorded) stored,
  note           text,
  prepared_by    uuid references auth.users (id) on delete set null,
  prepared_at    timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text
);
create unique index if not exists cashier_reconciliations_day_uidx on public.cashier_reconciliations (cashier_id, business_date) where status <> 'rejected';
create index if not exists cashier_reconciliations_date_idx on public.cashier_reconciliations (business_date);
create index if not exists cashier_reconciliations_district_idx on public.cashier_reconciliations (district_id);
create index if not exists cashier_reconciliations_prepared_by_idx on public.cashier_reconciliations (prepared_by);
create index if not exists cashier_reconciliations_decided_by_idx on public.cashier_reconciliations (decided_by);

create table if not exists public.cashier_reconciliation_lines (
  id                 bigint generated always as identity primary key,
  reconciliation_id  uuid not null references public.cashier_reconciliations (id) on delete cascade,
  channel            text not null check (channel in ('cash', 'evc_plus', 'edahab', 'zaad', 'bank_transfer', 'card', 'other')),
  payments           int not null default 0,
  recorded           numeric(14, 2) not null,
  actual             numeric(14, 2) not null check (actual >= 0),
  difference         numeric(14, 2) generated always as (actual - recorded) stored,
  shortage           numeric(14, 2) generated always as (greatest(recorded - actual, 0)) stored,
  excess             numeric(14, 2) generated always as (greatest(actual - recorded, 0)) stored,
  unique (reconciliation_id, channel)
);

do $$
declare t text;
begin
  foreach t in array array['cashier_reconciliations', 'cashier_reconciliation_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end;
$$;
create policy cashier_reconciliations_select on public.cashier_reconciliations for select to authenticated
  using (cashier_id = (select auth.uid())
         or ((public.has_permission('reconciliation.view') or public.has_permission('payments.approve'))
             and (district_id is null or public.can_access_district(district_id))));
create policy cashier_reconciliation_lines_select on public.cashier_reconciliation_lines for select to authenticated
  using (exists (select 1 from public.cashier_reconciliations r where r.id = reconciliation_id));
create trigger audit after insert or update or delete on public.cashier_reconciliations for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.cashier_reconciliation_lines for each row execute function private.audit_row();

/** A cashier's payments on one day (UTC date of receipt), not reversed. */
create or replace function private.cashier_day_payments(p_cashier uuid, p_date date)
returns setof public.payments
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.payments
   where created_by = p_cashier and status <> 'reversed' and received_at >= p_date and received_at < p_date + 1;
$$;

/**
 * Cashier days in a period: what each cashier recorded per day, how much is still unchecked, and the day's
 * reconciliation if there is one.
 */
create or replace function public.cashier_days(p_from date, p_to date)
returns table (cashier_id uuid, cashier text, business_date date, district_id uuid, payments bigint, recorded numeric,
               pending bigint, verified bigint, disputed bigint, reconciliation_id uuid, number text, status text, actual numeric,
               difference numeric)
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
    with d as (
      select p.created_by, (p.received_at at time zone 'UTC')::date bd, min(p.district_id::text)::uuid district_id, count(*) n, sum(p.amount_base) amt,
             count(*) filter (where p.verify_status = 'pending') pend,
             count(*) filter (where p.verify_status in ('verified', 'reconciled')) ver,
             count(*) filter (where p.verify_status = 'disputed') dis
        from public.payments p
       where p.status <> 'reversed' and p.created_by is not null and p.received_at >= p_from and p.received_at < p_to + 1
         and private.can_view_payment(p.district_id, p.parcel_id)
       group by 1, 2
    )
    select d.created_by, pr.full_name, d.bd, d.district_id, d.n, d.amt, d.pend, d.ver, d.dis,
           r.id, r.number, r.status, r.actual, r.difference
      from d
      left join public.profiles pr on pr.user_id = d.created_by
      left join lateral (select * from public.cashier_reconciliations x where x.cashier_id = d.created_by and x.business_date = d.bd
                          order by (x.status <> 'rejected') desc, x.prepared_at desc limit 1) r on true
     order by d.bd desc, pr.full_name;
end;
$$;

/**
 * One cashier day per way of paying: recorded total and count, and a suggested actual —
 * cash: what was counted at the close of that day's shifts (less the float); others: what has been verified.
 */
create or replace function public.cashier_day_summary(p_cashier uuid, p_date date)
returns table (channel text, payments bigint, recorded numeric, suggested numeric, pending bigint, disputed bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counted numeric;
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  select sum(s.counted_cash - s.opening_float) into v_counted
    from public.cashier_shifts s
   where s.cashier_id = p_cashier and s.status in ('closed', 'approved') and s.opened_at >= p_date and s.opened_at < p_date + 1
     and (s.district_id is null or public.can_access_district(s.district_id));
  return query
    with ch(c, sort) as (values ('cash', 1), ('evc_plus', 2), ('edahab', 3), ('zaad', 4), ('bank_transfer', 5), ('card', 6), ('other', 7)),
    p as (
      select private.collection_channel(x.method, x.wallet) c, x.amount_base, x.verify_status
        from private.cashier_day_payments(p_cashier, p_date) x
       where private.can_view_payment(x.district_id, x.parcel_id)
    )
    select ch.c, count(p.c), coalesce(sum(p.amount_base), 0),
           case when ch.c = 'cash' then coalesce(v_counted, coalesce(sum(p.amount_base) filter (where p.verify_status in ('verified', 'reconciled')), 0))
                else coalesce(sum(p.amount_base) filter (where p.verify_status in ('verified', 'reconciled')), 0) end,
           count(p.c) filter (where p.verify_status = 'pending'), count(p.c) filter (where p.verify_status = 'disputed')
      from ch left join p on p.c = ch.c
     group by ch.c, ch.sort
     order by ch.sort;
end;
$$;

/**
 * Finance officer: reconcile a cashier's day. p_actual: {channel: amount actually received}, one for every way of
 * paying the cashier recorded money in. A difference anywhere needs a note.
 */
create or replace function public.cashier_recon_submit(p_cashier uuid, p_date date, p_actual jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_district uuid;
  r record;
  v_actual numeric;
  v_rec numeric := 0;
  v_act numeric := 0;
  v_diff boolean := false;
begin
  perform private.assert_permission('reconciliation.update');
  perform private.assert_maker_checker(p_cashier);
  if p_date is null or p_date > current_date then
    perform private.raise_app_error('VALIDATION', 'date');
  end if;
  if jsonb_typeof(p_actual) <> 'object' then
    perform private.raise_app_error('VALIDATION', 'actual');
  end if;
  select min(district_id::text)::uuid into v_district from private.cashier_day_payments(p_cashier, p_date);
  if not exists (select 1 from private.cashier_day_payments(p_cashier, p_date) x where private.can_view_payment(x.district_id, x.parcel_id)) then
    perform private.raise_app_error('NOT_FOUND', 'cashier_day');
  end if;
  if exists (select 1 from private.cashier_day_payments(p_cashier, p_date) x where not private.can_view_payment(x.district_id, x.parcel_id)) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  insert into public.cashier_reconciliations (number, cashier_id, district_id, business_date, recorded, actual, note, prepared_by)
  values ('CR-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(private.next_serial('CR-' || to_char(p_date, 'YYYYMMDD'))::text, 3, '0'),
          p_cashier, v_district, p_date, 0, 0, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  for r in
    select private.collection_channel(x.method, x.wallet) c, count(*) n, sum(x.amount_base) amt
      from private.cashier_day_payments(p_cashier, p_date) x group by 1
    union all
    -- Money found with no recorded payment (e.g. an extra EVC transfer) can be entered too.
    select k, 0, 0 from jsonb_object_keys(p_actual) k
     where k not in (select private.collection_channel(x.method, x.wallet) from private.cashier_day_payments(p_cashier, p_date) x)
  loop
    if r.c not in ('cash', 'evc_plus', 'edahab', 'zaad', 'bank_transfer', 'card', 'other') then
      perform private.raise_app_error('VALIDATION', 'actual');
    end if;
    if not (p_actual ? r.c) or jsonb_typeof(p_actual -> r.c) <> 'number' then
      perform private.raise_app_error('VALIDATION', 'actual_missing');
    end if;
    v_actual := round((p_actual ->> r.c)::numeric, 2);
    if v_actual < 0 then
      perform private.raise_app_error('VALIDATION', 'actual');
    end if;
    if r.amt = 0 and v_actual = 0 then
      continue;
    end if;
    insert into public.cashier_reconciliation_lines (reconciliation_id, channel, payments, recorded, actual)
    values (v_id, r.c, r.n, r.amt, v_actual);
    v_rec := v_rec + r.amt;
    v_act := v_act + v_actual;
    v_diff := v_diff or v_actual <> r.amt;
  end loop;
  if v_diff and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.cashier_reconciliations set recorded = v_rec, actual = v_act where id = v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'already_reconciled');
end;
$$;

/** Finance Manager: approve (payments become Reconciled) or reject (with a reason) a cashier's day. */
create or replace function public.cashier_recon_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_reconciliations;
begin
  perform private.assert_permission('reconciliation.approve');
  select * into v from public.cashier_reconciliations where id = p_id for update;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'reconciliation');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.prepared_by);
  perform private.assert_maker_checker(v.cashier_id);
  if not p_approve then
    if length(coalesce(trim(p_note), '')) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.cashier_reconciliations set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    return;
  end if;
  update public.cashier_reconciliations set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  update public.payments p set verify_status = 'reconciled',
         verified_by = coalesce(p.verified_by, auth.uid()), verified_at = coalesce(p.verified_at, now())
   where p.id in (select x.id from private.cashier_day_payments(v.cashier_id, v.business_date) x)
     and p.verify_status in ('pending', 'verified');
end;
$$;

-- ---------------------------------------------------------------------------
-- Statement matching: desk payments carry their reference in `reference`.
-- ---------------------------------------------------------------------------
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
    select upper(trim(r ->> 'provider_ref')) as ref, round((r ->> 'amount')::numeric, 2) as amount, nullif(r ->> 'date', '')::date as d
    from jsonb_array_elements(p_rows) r where coalesce(trim(r ->> 'provider_ref'), '') <> ''
  ), sys as (
    select id, upper(coalesce(provider_ref, reference)) as ref, amount from public.payments
    where provider = p_provider and status <> 'reversed' and received_at::date between p_from and p_to
      and coalesce(provider_ref, reference) is not null
  )
  insert into public.reconciliation_lines (batch_id, provider_ref, amount, line_date, status, payment_id, system_amount)
  select v_id, coalesce(r.ref, s.ref), r.amount, r.d,
         case when s.id is null then 'missing_in_system'::public.recon_status
              when r.ref is null then 'missing_in_provider'::public.recon_status
              when r.amount <> s.amount then 'amount_mismatch'::public.recon_status
              else 'matched'::public.recon_status end,
         s.id, s.amount
  from report r full outer join sys s on s.ref = r.ref;

  -- A matched statement line is the evidence a finance officer needs: pending payments become Verified
  -- (not the uploader's own takings).
  if public.has_permission('reconciliation.update') then
    update public.payments p set verify_status = 'verified', verified_by = auth.uid(), verified_at = now()
     where p.id in (select payment_id from public.reconciliation_lines where batch_id = v_id and status = 'matched')
       and p.verify_status = 'pending' and p.created_by is distinct from auth.uid();
  end if;

  select jsonb_object_agg(status, n) into v_summary from (select status::text, count(*) n from public.reconciliation_lines where batch_id = v_id group by status) x;
  update public.reconciliation_batches set summary = coalesce(v_summary, '{}'::jsonb) where id = v_id;
  return jsonb_build_object('id', v_id, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

revoke all on function private.cashier_day_payments(uuid, date) from public, anon, authenticated;
revoke all on function public.cashier_days(date, date), public.cashier_day_summary(uuid, date),
  public.cashier_recon_submit(uuid, date, jsonb, text), public.cashier_recon_decide(uuid, boolean, text) from public, anon;
grant execute on function public.cashier_days(date, date), public.cashier_day_summary(uuid, date),
  public.cashier_recon_submit(uuid, date, jsonb, text), public.cashier_recon_decide(uuid, boolean, text) to authenticated;
