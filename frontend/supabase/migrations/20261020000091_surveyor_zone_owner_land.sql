-- Surveyors work their zones end to end: they see the houses in the neighbourhoods of their zones (and the land they
-- recorded), and Add land can take an owner already entered with the full owner form (owner_id) instead of a name.

create or replace function private.can_view_parcel(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.parcels p
    where p.id = p_id and private.caller_is_active()
      and ((public.has_permission('parcels.view') and public.can_access_district(p.district_id))
           or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                      where po.parcel_id = p.id and po.valid_to is null and pa.citizen_user_id = auth.uid())
           or (p.application_id is not null and private.can_view_application(p.application_id))
           -- Surveyors: the land they recorded, and every house in the neighbourhoods of their zones.
           or (public.has_permission('surveys.create')
               and (p.created_by = auth.uid()
                    or exists (select 1 from public.survey_zones z where z.neighbourhood_id = p.neighbourhood_id and z.surveyor_id = auth.uid()))))
  );
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
  return jsonb_build_object('parcel_id', v_parcel, 'party_id', v_party);
end;
$$;
