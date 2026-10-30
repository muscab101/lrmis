-- Partial land saved by a surveyor (field land) is billed straight away: the tax bill (width × length × the grade's
-- price per m²) and the service charge, as registration does (owner request 2026-10-30). Registration then raises
-- only what is still missing, so nothing is billed twice.

/** Raise the land's tax bill and service charge if it doesn't have them yet. Returns how many bills were raised. */
create or replace function private.parcel_bill(p_parcel uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_service public.fee_types;
  v_area numeric;
  v_tax numeric := 0;
  v_line text;
  v_label text;
  v_n int := 0;
  f record;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null then
    return 0;
  end if;
  -- How the land is named on the service charge line before it has a PUN.
  select coalesce(v.pun, n.code || coalesce(' · ' || v.house_no, '')) into v_label from public.neighbourhoods n where n.id = v.neighbourhood_id;
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
    select 'service_charge', round(v_service.amount, 2), coalesce(v_service.name_en, 'Service charge') || coalesce(' — ' || v_label, ''), 'service'
     where v_service.id is not null
  loop
    if not exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = v.id and ft.code = f.code and i.status <> 'cancelled') then
      perform private.parcel_raise_invoice(v.id, f.code, f.amount, f.line, f.kind);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.parcel_bill(uuid) from public, anon, authenticated;

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
  insert into public.parcels (district_id, neighbourhood_id, house_no, property_type, land_use, area_m2,
                              plot_width_m, plot_length_m, geom, geom_provisional, status, created_by)
  values (v_district, v_nbhd, v_house, v_type, coalesce(nullif(p ->> 'land_use', ''), 'residential')::public.land_use,
          v_width * v_length, v_width, v_length,
          extensions.st_envelope(extensions.st_buffer(v_pin::extensions.geography, v_half::float8)::extensions.geometry),
          true, 'draft', auth.uid())
  returning id into v_parcel;
  insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_parcel, v_party, 'owner', 100);
  perform private.parcel_event(v_parcel, 'field_land_created', nullif(trim(p ->> 'note'), ''),
    jsonb_build_object('pin', jsonb_build_array(v_lon, v_lat), 'accuracy_m', nullif(p ->> 'pin_accuracy_m', '')));
  -- Billed now: the tax bill and the service charge.
  v_bills := private.parcel_bill(v_parcel);
  return jsonb_build_object('parcel_id', v_parcel, 'party_id', v_party, 'bills', v_bills);
end;
$$;
