-- Taking a payment at desk "11" (prefix KR) failed: receipt numbers were counted per desk *code*, so after the desk's
-- code changed from KR to 11 the count started again at 1 and produced KR-2026-000001, which already existed
-- (duplicate key on payments.receipt_no). Receipts are now counted per receipt *prefix* and year — what the number
-- actually shows — starting above the highest number already used, and a number that is somehow taken is skipped.

/** The next free receipt number for a prefix and year: PREFIX-YYYY-000001. */
create or replace function private.next_receipt_no(p_prefix text, p_year int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := 'RCP-' || p_prefix || '-' || p_year;
  v_base text := p_prefix || '-' || p_year || '-';
  v_used int;
  v_no text;
begin
  insert into public.serial_counters (scope) values (v_scope) on conflict do nothing;
  select coalesce(max(nullif(regexp_replace(substr(receipt_no, length(v_base) + 1), '\D', '', 'g'), '')::int), 0) into v_used
    from public.payments where receipt_no like v_base || '%';
  update public.serial_counters set last_serial = greatest(last_serial, v_used) where scope = v_scope;
  loop
    v_no := v_base || lpad(private.next_serial(v_scope)::text, 6, '0');
    exit when not exists (select 1 from public.payments where receipt_no = v_no);
  end loop;
  return v_no;
end;
$$;
revoke all on function private.next_receipt_no(text, int) from public, anon, authenticated;

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
  v_receipt := private.next_receipt_no(v_pos.receipt_prefix, extract(year from v_received)::int);

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
