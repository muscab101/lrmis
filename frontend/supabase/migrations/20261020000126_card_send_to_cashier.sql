-- A card made before the ID card print fee was switched on has no print bill. Print staff can now send it to the
-- cashier from the card: the bill is raised at the fixed fee and the district's cashiers are told; the card prints
-- once it is paid (0076). New cards are billed the same way automatically (0125).

/** Raise a card's print bill and tell the district's cashiers. Returns the invoice number (null when the fee is off). */
create or replace function private.card_raise_bill(p_card uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_fee public.fee_types;
  v_inv uuid;
  v_number text;
  v_user uuid;
begin
  select * into v from public.issued_documents where id = p_card for update;
  if v.id is null or v.type <> 'id_card' or v.status <> 'valid' then
    return null;
  end if;
  select number into v_number from public.invoices where id = v.print_fee_invoice_id and status <> 'cancelled';
  if v_number is not null then
    return v_number;
  end if;
  v_fee := private.card_fee();
  if v_fee.id is null then
    return null;
  end if;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), v.parcel_id, v.district_id, v_fee.id,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-id_card_print-' || v.parcel_id),
          current_date, current_date + 30, v_fee.amount, 'ID card print · ' || v.serial, auth.uid())
  returning id, number into v_inv, v_number;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
  values (v_inv, 'fee', 'ID card print — ' || v.serial, v_fee.amount, auth.uid());
  update public.issued_documents set print_fee_invoice_id = v_inv where id = v.id;
  perform private.parcel_event(v.parcel_id, 'card_print_billed', null, jsonb_build_object('document_id', v.id, 'invoice_id', v_inv));
  for v_user in
    select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
     where rp.permission_key = 'payments.create' and private.user_can_access_district(ur.user_id, v.district_id)
       and exists (select 1 from public.profiles pr where pr.user_id = ur.user_id and pr.kind = 'staff' and pr.status = 'active')
  loop
    perform private.notify(v_user, 'card.print_bill', 'Biilka daabacaadda kaarka: ' || v_number || ' · ' || v.serial,
                           'ID card print bill to collect: ' || v_number || ' · ' || v.serial, '/cashier?find=' || v_number);
  end loop;
  return v_number;
end;
$$;
revoke all on function private.card_raise_bill(uuid) from public, anon, authenticated;

create or replace function private.card_bill_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'id_card' and new.status = 'valid' and new.print_fee_invoice_id is null then
    perform private.card_raise_bill(new.id);
  end if;
  return null;
end;
$$;

/** Print staff: send a card's print bill to the cashier (raises it if missing). Returns the invoice number. */
create or replace function public.card_send_to_cashier(p_card uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_number text;
begin
  if not (public.has_permission('certificates.print') or public.has_permission('certificates.id_cards') or public.has_permission('documents.print')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'certificates.print');
  end if;
  select * into v from public.issued_documents where id = p_card and type = 'id_card';
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if v.print_count > 0 then
    perform private.raise_app_error('CONFLICT', 'already_printed');
  end if;
  v_number := private.card_raise_bill(p_card);
  if v_number is null then
    perform private.raise_app_error('CONFLICT', 'card_fee_not_set');
  end if;
  return v_number;
end;
$$;
revoke all on function public.card_send_to_cashier(uuid) from public, anon;
grant execute on function public.card_send_to_cashier(uuid) to authenticated;
