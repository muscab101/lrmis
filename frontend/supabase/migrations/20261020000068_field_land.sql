-- Field land: a surveyor who finds a house adds it straight to Parcels → Partial registration, with no
-- application. It is a draft parcel with a provisional square around the GPS pin (sized from the plot's
-- width × length), the house number, grade, land use and the owner. Later an officer starts its
-- registration: that creates the application (channel "field") around the same parcel and moves the
-- owner onto the application, so billing, survey, verification and registration run as usual.

-- House numbers in use: parcels with no application (field land) were skipped when no application was
-- given (null is distinct from null is false), so a new application could reuse a field house number.
create or replace function private.house_numbers_in_use(p_neighbourhood uuid, p_application uuid)
returns table (house_no text, apartment boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.house_no, bool_and(x.apartment)
  from (
    select a.house_no, private.is_apartment_type(a.property_type) as apartment
    from public.applications a
    where a.neighbourhood_id = p_neighbourhood and a.house_no is not null
      and a.status not in ('rejected', 'cancelled') and a.id is distinct from p_application
    union all
    select p.house_no, private.is_apartment_type(p.property_type)
    from public.parcels p
    where p.neighbourhood_id = p_neighbourhood and p.house_no is not null and p.deleted_at is null
      and (p_application is null
           or (p.application_id is distinct from p_application
               and p.id is distinct from (select parcel_id from public.applications where id = p_application)))
  ) x
  group by x.house_no;
$$;

alter table public.parcels
  add column if not exists plot_width_m numeric(9, 2) check (plot_width_m is null or plot_width_m > 0),
  add column if not exists plot_length_m numeric(9, 2) check (plot_length_m is null or plot_length_m > 0);

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
  v_pin extensions.geometry;
  v_nbhd uuid;
  v_half numeric;
  v_parcel uuid;
  v_party uuid;
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
  if v_name is null or length(v_name) < 3 then
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

  insert into public.parties (kind, full_name, phone, district_id, created_by)
  values ('person', v_name, v_phone, v_district, auth.uid())
  returning id into v_party;

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
  return jsonb_build_object('parcel_id', v_parcel, 'party_id', v_party);
end;
$$;

/** Turn field land into an application (draft, channel "field") around the same parcel. */
create or replace function public.field_land_start_registration(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
  v_number text;
  v_owner uuid;
begin
  perform private.assert_permission('applications.create');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.application_id is not null or v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'already_started');
  end if;
  select po.party_id into v_owner from public.parcel_owners po
   where po.parcel_id = v.id and po.valid_to is null order by po.share_pct desc nulls last limit 1;

  v_number := 'APP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_number_seq')::text, 6, '0');
  insert into public.applications (number, type, channel, district_id, neighbourhood_id, pin, applicant_party_id, parcel_id,
                                   house_no, property_type, land_use, plot_width_m, plot_length_m, created_by)
  values (v_number, 'new_registration', 'field', v.district_id, v.neighbourhood_id, extensions.st_centroid(v.geom),
          v_owner, v.id, v.house_no, v.property_type, v.land_use, v.plot_width_m, v.plot_length_m, auth.uid())
  returning id into v_id;
  update public.parcels set application_id = v_id where id = v.id;

  -- Registration writes the owners from the application, so they move there from the draft parcel.
  insert into public.application_parties (application_id, party_id, role, share_pct, added_by)
  select v_id, po.party_id, po.role, po.share_pct, auth.uid()
    from public.parcel_owners po where po.parcel_id = v.id and po.valid_to is null;
  delete from public.parcel_owners where parcel_id = v.id and source_application_id is null;

  perform private.application_event(v_id, 'created', null, 'draft', 'From field land');
  perform private.parcel_event(v.id, 'registration_started', null, jsonb_build_object('application_id', v_id));
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

grant execute on function public.field_land_create(jsonb), public.field_land_start_registration(uuid) to authenticated;
revoke execute on function public.field_land_create(jsonb), public.field_land_start_registration(uuid) from public, anon;
