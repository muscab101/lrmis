-- Apartments, the simple way (owner's rule, 2026-11-15):
--
--   Plot 600 m², three flats of 100 m² = 300 m² of flats.
--   * Each flat is billed on its own m²: a ground-floor flat at the "Apartment" price, a flat on floor 1, 2, 3 … at the
--     "Upper Floors" price.
--   * The rest of the plot (600 − 300 = 300 m²) is open ground, billed to the building's manager at the
--     "Open ground" price (plus any extra areas, see 0234).
--   * The manager is a person: the owner entered when the building is added (or a name typed for them).
-- This replaces the unit-factor share of the footprint (0204): the footprint is now the flats' m² added up.

/** A flat's price type by its floor: ground floor = Apartment, upper floors = Upper Floors (else the building's type). */
create or replace function private.flat_grade(p_floor int, p_default text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when coalesce(p_floor, 0) = 0 then
             case when exists (select 1 from public.property_grades where code = 'apartment' and active) then 'apartment' else p_default end
           when exists (select 1 from public.property_grades where code = 'upper' and active) then 'upper'
           when exists (select 1 from public.property_grades where code = 'apartment' and active) then 'apartment'
           else p_default
         end;
$$;

/** One flat's property bill follows its m² and price type (also once registered); never below what is already paid. */
create or replace function private.unit_bill_adjust(p_unit uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_inv public.invoices;
  v_want numeric;
begin
  select * into v from public.parcels where id = p_unit;
  if v.id is null or v.parent_id is null or v.deleted_at is not null then
    return;
  end if;
  select * into v_grade from public.property_grades where code = v.property_type;
  if coalesce(v_grade.amount, 0) <= 0 or coalesce(v.area_m2, 0) <= 0 then
    return;
  end if;
  v_want := round(v.area_m2 * v_grade.amount, 2);
  select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = p_unit and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1;
  if v_inv.id is null then
    perform private.parcel_bill(p_unit);
  elsif v_inv.total <> v_want and v_want >= v_inv.paid + v_inv.credited then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv.id, 'tax', 'Re-bill: ' || v_grade.name_en || ': ' || coalesce(v.unit_no, '') || coalesce(' (floor ' || v.unit_floor || ')', '') || ' — '
              || trim(to_char(v.area_m2, 'FM9999990.##')) || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00'))
              || ' USD per m² (was ' || v_inv.total || ' USD)',
            v_want - v_inv.total, auth.uid());
    update public.invoices set total = v_want where id = v_inv.id;
    perform private.invoice_refresh_status(v_inv.id);
    perform private.parcel_event(p_unit, 'rebilled', null, jsonb_build_object('invoice', v_inv.number, 'from', v_inv.total, 'to', v_want));
  end if;
end;
$$;
revoke all on function private.unit_bill_adjust(uuid) from public, anon, authenticated;

/** A flats building: each flat on its own m² and price type, the rest of the plot to the manager. */
create or replace function private.flats_apportion(p_building uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_total numeric;
  v_plot numeric;
  u record;
begin
  select * into b from public.parcels where id = p_building;
  if b.id is null or b.layout <> 'flats' then
    return;
  end if;
  select sum(own_m2) into v_total from public.parcels where parent_id = b.id and deleted_at is null;
  if coalesce(v_total, 0) <= 0 then
    return;
  end if;
  v_plot := round(b.plot_width_m * b.plot_length_m, 2);
  perform set_config('app.land_change', 'on', true);
  update public.parcels p
     set area_m2 = p.own_m2, shared_m2 = 0, unit_factor = null,
         property_type = private.flat_grade(p.unit_floor, coalesce(b.property_type, p.property_type)), updated_at = now()
   where p.parent_id = b.id and p.deleted_at is null
     and (p.area_m2 is distinct from p.own_m2 or coalesce(p.shared_m2, 0) <> 0 or p.unit_factor is not null
          or p.property_type is distinct from private.flat_grade(p.unit_floor, coalesce(b.property_type, p.property_type)));
  -- The built part is the flats' m²; never more than the plot (the rest, if any, is open ground).
  update public.parcels set footprint_m2 = case when v_plot > 0 then least(v_total, v_plot) else v_total end, updated_at = now()
   where id = b.id and footprint_m2 is distinct from (case when v_plot > 0 then least(v_total, v_plot) else v_total end);
  perform set_config('app.land_change', 'off', true);
  for u in select p.id from public.parcels p where p.parent_id = b.id and p.deleted_at is null loop
    perform private.unit_bill_adjust(u.id);
  end loop;
  perform private.building_ground_bill(b.id);
end;
$$;
revoke all on function private.flats_apportion(uuid) from public, anon, authenticated;

-- A flat's size or floor changing (or a flat removed) bills the building again.
create or replace function private.flats_reapportion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null
     and (old.own_m2 is distinct from new.own_m2 or old.unit_floor is distinct from new.unit_floor or old.deleted_at is distinct from new.deleted_at)
     and exists (select 1 from public.parcels b where b.id = new.parent_id and b.layout = 'flats' and b.deleted_at is null) then
    perform private.flats_apportion(new.parent_id);
  end if;
  return null;
end;
$$;
drop trigger if exists flats_reapportion on public.parcels;
create trigger flats_reapportion after update of own_m2, unit_floor, deleted_at on public.parcels
  for each row execute function private.flats_reapportion();

-- Adding a building: flats get their price type by floor, and the manager is a person (the owner entered, or a new one).
do $$
declare
  d text := pg_get_functiondef('public.land_with_units_create(jsonb)'::regprocedure);
  a1 text := '  v_party uuid;
';
  b1 text := '  v_party uuid;
  v_mgr uuid;
  m public.parties;
';
  a2 text := 'then v_house || ''-'' || v_no end, v_no, v_type, v_use,';
  b2 text := 'then v_house || ''-'' || v_no end, v_no,
            case when v_layout = ''flats'' then private.flat_grade((v_u ->> ''floor'')::int, v_type) else v_type end, v_use,';
  a3 text := '  -- Flats: each one''s share of the whole building (unit factor) and the open-ground bill to the management.
  perform private.flats_apportion(v_parent);';
  b3 text := '  -- Flats: the manager (a person) holds the building and pays its open ground.
  if v_layout = ''flats'' then
    v_mgr := nullif(p ->> ''manager_party_id'', '''')::uuid;
    if v_mgr is not null then
      select * into m from public.parties where id = v_mgr and deleted_at is null;
      if m.id is null then
        perform private.raise_app_error(''NOT_FOUND'', ''manager'');
      end if;
    elsif length(coalesce(trim(p ->> ''manager_name''), '''')) >= 3 then
      insert into public.parties (kind, full_name, phone, district_id, created_by)
      values (''person'', trim(p ->> ''manager_name''), nullif(trim(coalesce(p ->> ''manager_phone'', '''')), ''''), v_district, auth.uid())
      returning * into m;
    end if;
    if m.id is not null then
      insert into public.parcel_owners (parcel_id, party_id, role) values (v_parent, m.id, ''manager'');
      update public.parcels set manager_party_id = m.id, manager_name = m.full_name, manager_phone = m.phone where id = v_parent;
    end if;
  end if;
  -- Flats: each one on its own m² and floor price, and the rest of the plot billed to the manager.
  perform private.flats_apportion(v_parent);';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'land_with_units_create: anchors not found';
  end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;
