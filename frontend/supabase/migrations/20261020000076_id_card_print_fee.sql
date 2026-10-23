-- ID card printing is paid for: when a customer asks for a card, the cashier raises an "ID card print"
-- bill for that card; once it is paid the card can be printed. Every print needs its own paid bill (a
-- reprint is a new card, so it needs a new bill). The fee type starts switched off with no amount; while
-- it is off (or 0) cards print as before. Staff set the amount and switch it on in Valuation → Fee types.

insert into public.fee_types (code, name_so, name_en, interval, amount, active, sort)
values ('id_card_print', 'Daabacaadda kaarka aqoonsiga', 'ID card print', 'one_off', 0, false, 60)
on conflict (code) do nothing;

alter table public.issued_documents
  add column if not exists print_fee_invoice_id uuid references public.invoices (id);

/** The card fee applies when its fee type is switched on with an amount above 0. */
create or replace function private.card_fee()
returns public.fee_types
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.fee_types where code = 'id_card_print' and active and coalesce(amount, 0) > 0;
$$;

/** Cashier: raise (or reuse the open) ID card print bill for a card. */
create or replace function public.card_print_bill(p_card uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_fee public.fee_types;
  v_open public.invoices;
  v_inv uuid;
  v_number text;
begin
  if not (public.has_permission('payments.create') or public.has_permission('cashier.create')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'payments.create');
  end if;
  select * into v from public.issued_documents where id = p_card and type = 'id_card' for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if v.print_count > 0 then
    perform private.raise_app_error('CONFLICT', 'already_printed');
  end if;
  v_fee := private.card_fee();
  if v_fee.id is null then
    perform private.raise_app_error('CONFLICT', 'card_fee_not_set');
  end if;
  select * into v_open from public.invoices where id = v.print_fee_invoice_id and status <> 'cancelled';
  if v_open.id is not null then
    return jsonb_build_object('invoice_id', v_open.id, 'number', v_open.number, 'status', v_open.status, 'existing', true);
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
  return jsonb_build_object('invoice_id', v_inv, 'number', v_number, 'status', 'issued', 'existing', false);
end;
$$;

/** Cashier: a house's ID cards by PUN or card serial, with the print bill's state. */
create or replace function public.card_print_lookup(p_q text)
returns table (id uuid, serial text, holder text, pun text, print_count int, status text,
               invoice_id uuid, invoice_number text, invoice_status text, fee_on boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := upper(replace(trim(coalesce(p_q, '')), '-', ''));
begin
  if not public.has_permission('cashier.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'cashier.view');
  end if;
  if length(v_q) < 3 then
    return;
  end if;
  return query
    select d.id, d.serial, pa.full_name, p.pun, d.print_count, d.status::text, i.id, i.number, i.status::text,
           (private.card_fee()).id is not null
      from public.issued_documents d
      join public.parcels p on p.id = d.parcel_id
      left join public.parties pa on pa.id = d.party_id
      left join public.invoices i on i.id = d.print_fee_invoice_id
     where d.type = 'id_card' and d.status = 'valid' and public.can_access_district(d.district_id)
       and (p.pun = v_q or upper(replace(d.serial, '-', '')) = v_q)
     order by d.issued_at desc
     limit 50;
end;
$$;

/** Log the first print. Any later print must go through a reprint request; an ID card needs its paid print bill. */
create or replace function public.document_print(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
begin
  perform private.assert_permission('certificates.print');
  select * into v from public.issued_documents where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if v.print_count > 0 then
    perform private.raise_app_error('CONFLICT', 'already_printed');
  end if;
  if v.type = 'id_card' and (private.card_fee()).id is not null
     and not exists (select 1 from public.invoices i where i.id = v.print_fee_invoice_id and i.status = 'paid') then
    perform private.raise_app_error('CONFLICT', 'card_fee_unpaid');
  end if;
  update public.issued_documents set print_count = print_count + 1 where id = p_id;
  insert into public.print_jobs (document_id, kind, printed_by) values (p_id, case when v.replaces_id is null then 'original' else 'reprint' end, auth.uid());
  perform private.parcel_event(v.parcel_id, v.type::text || '_printed', null, jsonb_build_object('document_id', p_id, 'serial', v.serial));
  return jsonb_build_object('serial', v.serial, 'print_count', v.print_count + 1);
end;
$$;

revoke all on function private.card_fee() from public, anon, authenticated;
grant execute on function public.card_print_bill(uuid), public.card_print_lookup(text) to authenticated;
revoke execute on function public.card_print_bill(uuid), public.card_print_lookup(text) from public, anon;
