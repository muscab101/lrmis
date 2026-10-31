-- The parcel edit (Partial and Registered) can also change the plot size (width × length), the land use, the number
-- of units on the land, and, for partial land, the owner's name and phone. Registered land changes owners only
-- through a transfer. Land still drawn as a provisional square gets its area and square resized; a surveyed boundary
-- keeps its own area. Bills already raised keep their amounts.

alter table public.parcels add column if not exists units int check (units is null or units between 1 and 500);

create or replace function public.parcel_update_details(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_type text := nullif(trim(p ->> 'property_type'), '');
  v_width numeric;
  v_length numeric;
  v_half numeric;
  v_party uuid;
  v_name text := nullif(trim(p ->> 'owner_name'), '');
  v_phone text := nullif(trim(p ->> 'owner_phone'), '');
begin
  perform private.assert_permission('parcels.update');
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  if p ? 'property_type' and v_type is not null and v_type is distinct from v.property_type
     and not exists (select 1 from public.property_grades g where g.code = v_type and g.active) then
    perform private.raise_app_error('VALIDATION', 'property_type');
  end if;
  if p ? 'plot_width_m' or p ? 'plot_length_m' then
    begin
      v_width := nullif(p ->> 'plot_width_m', '')::numeric;
      v_length := nullif(p ->> 'plot_length_m', '')::numeric;
    exception when others then
      perform private.raise_app_error('VALIDATION', 'plot_size');
    end;
    if v_width is null or v_length is null or v_width <= 0 or v_length <= 0 or v_width > 5000 or v_length > 5000 then
      perform private.raise_app_error('VALIDATION', 'plot_size');
    end if;
  end if;
  if p ? 'units' and nullif(p ->> 'units', '') is not null
     and (p ->> 'units' !~ '^\d+$' or (p ->> 'units')::int not between 1 and 500) then
    perform private.raise_app_error('VALIDATION', 'units');
  end if;

  update public.parcels
     set house_no = case when p ? 'house_no' then nullif(trim(p ->> 'house_no'), '') else house_no end,
         govt_receipt_no = case when p ? 'govt_receipt_no' then nullif(trim(p ->> 'govt_receipt_no'), '') else govt_receipt_no end,
         plot_no = case when p ? 'plot_no' then nullif(trim(p ->> 'plot_no'), '') else plot_no end,
         property_type = case when p ? 'property_type' then v_type else property_type end,
         flat_no = case when p ? 'flat_no' then nullif(trim(p ->> 'flat_no'), '') else flat_no end,
         land_use = case when p ? 'land_use' and nullif(p ->> 'land_use', '') is not null then (p ->> 'land_use')::public.land_use else land_use end,
         units = case when p ? 'units' then nullif(p ->> 'units', '')::int else units end,
         plot_width_m = coalesce(v_width, plot_width_m),
         plot_length_m = coalesce(v_length, plot_length_m)
   where id = p_id;

  -- A provisional square follows the new size, centred where it was.
  if v_width is not null and v.geom_provisional then
    v_half := greatest(least(sqrt(v_width * v_length) / 2, 100), 2);
    update public.parcels
       set area_m2 = round(v_width * v_length, 2),
           geom = extensions.st_envelope(extensions.st_buffer(extensions.st_centroid(v.geom)::extensions.geography, v_half::float8)::extensions.geometry)
     where id = p_id;
  end if;

  -- The owner's name and phone, on partial land only (registered land changes owners by transfer).
  if (p ? 'owner_name' or p ? 'owner_phone') and v.status in ('draft', 'surveyed', 'verified') then
    if v_name is null or length(v_name) < 3 then
      perform private.raise_app_error('VALIDATION', 'owner_name');
    end if;
    select po.party_id into v_party from public.parcel_owners po
     where po.parcel_id = p_id and po.valid_to is null order by (po.role = 'owner') desc, po.created_at limit 1;
    if v_party is not null then
      update public.parties set full_name = v_name, phone = v_phone where id = v_party;
    end if;
  end if;

  perform private.parcel_event(p_id, 'details_updated', null, p);
end;
$$;
