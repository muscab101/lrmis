-- 1. Land a surveyor saves (field land) gets its PUN and account number straight away, not when it is moved to
--    Registered; registration keeps them (owner request 2026-10-30). An application's land still gets its PUN at
--    registration, so rejected applications use no numbers.
-- 2. A new ID card is billed straight away when the "ID card print" fee is on (Valuation → Fee types): the bill is
--    raised and the cashiers of the card's district are told. The card prints once the bill is paid (0076).

-- Field land saved before this, still waiting: give it its PUN now.
do $$
declare
  r record;
  v_ids record;
begin
  for r in select id, district_id, neighbourhood_id from public.parcels
            where pun is null and deleted_at is null and application_id is null and neighbourhood_id is not null
              and status in ('draft', 'surveyed', 'verified') order by created_at loop
    select * into v_ids from private.next_pun(r.district_id, r.neighbourhood_id);
    update public.parcels set pun = v_ids.pun, account_no = coalesce(account_no, v_ids.account_no) where id = r.id;
  end loop;
end;
$$;

/** Raise the print bill for a new card (no permission check: called by the card trigger) and tell the cashiers. */
create or replace function private.card_bill_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.fee_types;
  v_inv uuid;
  v_number text;
  v_user uuid;
begin
  if new.type <> 'id_card' or new.status <> 'valid' or new.print_fee_invoice_id is not null then
    return null;
  end if;
  v_fee := private.card_fee();
  if v_fee.id is null then
    return null;
  end if;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), new.parcel_id, new.district_id, v_fee.id,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-id_card_print-' || new.parcel_id),
          current_date, current_date + 30, v_fee.amount, 'ID card print · ' || new.serial, auth.uid())
  returning id, number into v_inv, v_number;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
  values (v_inv, 'fee', 'ID card print — ' || new.serial, v_fee.amount, auth.uid());
  update public.issued_documents set print_fee_invoice_id = v_inv where id = new.id;
  perform private.parcel_event(new.parcel_id, 'card_print_billed', null, jsonb_build_object('document_id', new.id, 'invoice_id', v_inv));
  for v_user in
    select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
     where rp.permission_key = 'payments.create' and private.user_can_access_district(ur.user_id, new.district_id)
       and exists (select 1 from public.profiles pr where pr.user_id = ur.user_id and pr.kind = 'staff' and pr.status = 'active')
  loop
    perform private.notify(v_user, 'card.print_bill', 'Biilka daabacaadda kaarka: ' || v_number || ' · ' || new.serial,
                           'ID card print bill to collect: ' || v_number || ' · ' || new.serial, '/cashier?find=' || v_number);
  end loop;
  return null;
end;
$$;
revoke all on function private.card_bill_on_issue() from public, anon, authenticated;
drop trigger if exists card_bill_on_issue on public.issued_documents;
create trigger card_bill_on_issue after insert on public.issued_documents
  for each row execute function private.card_bill_on_issue();

create or replace function public.parcel_register(p_parcel uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_app public.applications;
  v_ids record;
  v_grade public.property_grades;
  v_service public.fee_types;
  v_tax numeric := 0;
  v_area numeric;
  v_line text;
  f record;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.status not in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  if v.neighbourhood_id is null then
    perform private.raise_app_error('CONFLICT', 'no_location');
  end if;
  -- The site check is optional; a surveyor who found no house there stops it.
  if v.site_check_status = 'not_found' then
    perform private.raise_app_error('CONFLICT', 'site_not_found');
  end if;

  -- An application started before: its owners come onto the parcel and it closes.
  if v.application_id is not null then
    select * into v_app from public.applications where id = v.application_id for update;
    if v_app.status not in ('approved', 'rejected', 'cancelled') then
      if exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id
                 where n.application_id = v_app.id and o.status in ('open', 'upheld')) then
        perform private.raise_app_error('CONFLICT', 'open_objection');
      end if;
      insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
      select v.id, ap.party_id, ap.role, ap.share_pct, v_app.id
        from public.application_parties ap
       where ap.application_id = v_app.id and ap.role in ('owner', 'co_owner', 'heir')
         and not exists (select 1 from public.parcel_owners po where po.parcel_id = v.id and po.party_id = ap.party_id and po.valid_to is null);
      update public.surveys set status = 'cancelled'
       where application_id = v_app.id and status in ('assigned', 'in_progress', 'returned', 'overlap_review');
      update public.public_notices set status = 'closed' where application_id = v_app.id and status = 'open';
    end if;
  end if;
  if not exists (select 1 from public.parcel_owners po where po.parcel_id = v.id and po.valid_to is null
                   and po.role in ('owner', 'co_owner', 'heir')) then
    perform private.raise_app_error('CONFLICT', 'no_owner');
  end if;

  -- The PUN given when the land was saved stays; land without one gets it now.
  if v.pun is not null and v.account_no is not null then
    select v.pun as pun, v.account_no as account_no into v_ids;
  else
    select * into v_ids from private.next_pun(v.district_id, v.neighbourhood_id);
  end if;
  update public.parcels
     set pun = v_ids.pun, account_no = v_ids.account_no, status = 'registered', registered_at = now(),
         registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v.id;

  -- The bills: tax (width × length × the grade's price per m²) and the service charge for a new house.
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;
  if coalesce(v_grade.amount, 0) > 0 and v.plot_width_m is not null and v.plot_length_m is not null then
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_tax := round(v_area * v_grade.amount, 2);
    v_line := v_grade.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × '
      || trim(to_char(v.plot_length_m, 'FM999990.##')) || ' m = ' || trim(to_char(v_area, 'FM9999990.##'))
      || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  end if;
  select * into v_service from public.fee_types where code = 'service_charge' and active and coalesce(amount, 0) > 0;
  for f in
    select 'property_bill' code, v_tax amount, v_line line, 'tax'::public.invoice_line_kind kind where v_tax > 0
    union all
    select 'service_charge', round(v_service.amount, 2), coalesce(v_service.name_en, 'Service charge') || ' — ' || v_ids.pun, 'service'
     where v_service.id is not null
  loop
    if not exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = v.id and ft.code = f.code and i.status <> 'cancelled') then
      perform private.parcel_raise_invoice(v.id, f.code, f.amount, f.line, f.kind);
    end if;
  end loop;

  -- The old application closes last: closing it tells the cashiers, which needs the PUN and the bills.
  if v_app.id is not null and v_app.status not in ('approved', 'rejected', 'cancelled') then
    update public.applications set status = 'approved', decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
     where id = v_app.id;
  end if;

  perform private.parcel_event(v.id, 'registered', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Registered'),
    jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'provisional_boundary', v.geom_provisional));
  insert into public.jobs (kind, payload, created_by)
  values ('sms.parcel_registered', jsonb_build_object('parcel_id', v.id, 'pun', v_ids.pun), auth.uid());
  return jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'parcel_id', v.id);
end;
$$;

create or replace function public.field_land_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_lon float8 := nullif(p ->> 'pin_lon', '')::float8;
  v_lat float8 := nullif(p ->> 'pin_lat', '')::float8;
  v_width numeric := nullif(p ->> 'plot_width_m', '')::numeric;
  v_length numeric := nullif(p ->> 'plot_length_m', '')::numeric;
  v_house text := nullif(trim(p ->> 'house_no'), '');
  v_type text := nullif(trim(p ->> 'property_type'), '');
  v_name text := nullif(trim(p ->> 'owner_name'), '');
  v_phone text := nullif(trim(p ->> 'owner_phone'), '');
  v_owner uuid := nullif(p ->> 'owner_id', '')::uuid;
  v_pin extensions.geometry;
  v_nbhd uuid;
  v_half numeric;
  v_parcel uuid;
  v_party uuid;
  v_bills int;
  v_ids record;
begin
  if not (public.has_permission('surveys.create') or public.has_permission('applications.create')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.create');
  end if;
  if v_district is null or not exists (select 1 from public.districts where id = v_district and deleted_at is null) then
    perform private.raise_app_error('VALIDATION', 'district');
  end if;
  if not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  if v_lon is null or v_lat is null then
    perform private.raise_app_error('VALIDATION', 'pin_required');
  end if;
  if v_width is null or v_length is null or v_width <= 0 or v_length <= 0 or v_width > 5000 or v_length > 5000 then
    perform private.raise_app_error('VALIDATION', 'plot_size');
  end if;
  -- An owner already entered with the full owner form, or a new one from the name and phone given here.
  if v_owner is not null then
    if not exists (select 1 from public.parties pa where pa.id = v_owner and pa.deleted_at is null
                     and (pa.district_id is null or public.can_access_district(pa.district_id))) then
      perform private.raise_app_error('NOT_FOUND', 'owner');
    end if;
  elsif v_name is null or length(v_name) < 3 then
    perform private.raise_app_error('VALIDATION', 'owner_name');
  end if;
  v_pin := extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326);
  v_nbhd := private.check_application_location(v_district, nullif(p ->> 'neighbourhood_id', '')::uuid, v_pin);
  if v_nbhd is null then
    perform private.raise_app_error('VALIDATION', 'neighbourhood');
  end if;
  if v_house is not null and exists (
       select 1 from private.house_numbers_in_use(v_nbhd, null) u
        where u.house_no = v_house and not (u.apartment and private.is_apartment_type(v_type))) then
    perform private.raise_app_error('CONFLICT', 'house_no_taken');
  end if;

  if v_owner is not null then
    v_party := v_owner;
  else
    insert into public.parties (kind, full_name, phone, district_id, created_by)
    values ('person', v_name, v_phone, v_district, auth.uid())
    returning id into v_party;
  end if;

  -- Half the side of a square with the plot's area, as for an application's provisional shape.
  v_half := greatest(least(sqrt(v_width * v_length) / 2, 100), 2);
  -- Its PUN and account number now, not at registration.
  select * into v_ids from private.next_pun(v_district, v_nbhd);
  insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, property_type, land_use, area_m2,
                              plot_width_m, plot_length_m, geom, geom_provisional, status, created_by)
  values (v_ids.pun, v_ids.account_no, v_district, v_nbhd, v_house, v_type, coalesce(nullif(p ->> 'land_use', ''), 'residential')::public.land_use,
          v_width * v_length, v_width, v_length,
          extensions.st_envelope(extensions.st_buffer(v_pin::extensions.geography, v_half::float8)::extensions.geometry),
          true, 'draft', auth.uid())
  returning id into v_parcel;
  insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_parcel, v_party, 'owner', 100);
  perform private.parcel_event(v_parcel, 'field_land_created', nullif(trim(p ->> 'note'), ''),
    jsonb_build_object('pin', jsonb_build_array(v_lon, v_lat), 'accuracy_m', nullif(p ->> 'pin_accuracy_m', '')));
  -- Billed now: the tax bill and the service charge.
  v_bills := private.parcel_bill(v_parcel);
  return jsonb_build_object('parcel_id', v_parcel, 'party_id', v_party, 'bills', v_bills, 'pun', v_ids.pun);
end;
$$;
