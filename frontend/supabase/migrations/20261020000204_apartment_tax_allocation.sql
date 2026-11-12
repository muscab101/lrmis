-- Apartment tax allocation (dual-layer property tax, owner decision 2026-11-10, "Tax Allocation Apartments").
--
--   Land plot (e.g. 600 m²) = the building's footprint (390 m², on 10 floors) + open ground (210 m²).
--   1. Each flat owner is billed for the flat's share of the whole built space:
--        unit factor   = flat's own area / all flats' own area × 10,000            (100 / 3,000 × 10,000 = 333.33)
--        taxable area  = unit factor / 10,000 × footprint × floors               (333.33 / 10,000 × 3,900 = 130 m²)
--        bill          = taxable area × the building type's price per m²
--      The taxable area is kept on the flat as area_m2 = own + shared (100 + 30), so every bill uses it as before.
--   2. The building's management gets one bill for the open ground: (plot − footprint) × the "Open ground" price.
-- Without a footprint yet, each flat is billed on its own area and there is no ground bill, until staff enter it.

alter table public.parcels
  add column footprint_m2 numeric(12, 2) check (footprint_m2 is null or footprint_m2 > 0),
  add column unit_factor numeric(10, 2),
  add column manager_name text check (manager_name is null or length(trim(manager_name)) between 2 and 200),
  add column manager_phone text;

-- The price per m² of a building's open ground (gardens, parking, gate), set in Valuation like any type.
insert into public.property_grades (code, name_so, name_en, amount, active, sort)
values ('open_ground', 'Dhul bannaan ee dhismaha', 'Open ground (building)', 0.10, true, 90)
on conflict (code) do nothing;

/** One flat's property bill follows its taxable area (also once registered); never below what is already paid. */
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
    values (v_inv.id, 'tax', 'Re-bill (apartment share): ' || v_grade.name_en || ': ' || v.unit_no || ' — '
              || trim(to_char(v.area_m2, 'FM9999990.##')) || ' m² (' || trim(to_char(v.own_m2, 'FM9999990.##')) || ' + '
              || trim(to_char(v.shared_m2, 'FM9999990.##')) || ' shared, unit factor ' || trim(to_char(v.unit_factor, 'FM99990.00'))
              || ') × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m² (was ' || v_inv.total || ' USD)',
            v_want - v_inv.total, auth.uid());
    update public.invoices set total = v_want where id = v_inv.id;
    perform private.invoice_refresh_status(v_inv.id);
    perform private.parcel_event(p_unit, 'rebilled', null, jsonb_build_object('invoice', v_inv.number, 'from', v_inv.total, 'to', v_want));
  end if;
end;
$$;
revoke all on function private.unit_bill_adjust(uuid) from public, anon, authenticated;

/** The building's open-ground bill to its management: (plot − footprint) × the "Open ground" price. */
create or replace function private.building_ground_bill(p_building uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_rate numeric := (select amount from public.property_grades where code = 'open_ground' and active);
  v_plot numeric;
  v_open numeric;
  v_want numeric;
  v_line text;
  v_inv public.invoices;
begin
  select * into b from public.parcels where id = p_building;
  if b.id is null or b.layout <> 'flats' or b.deleted_at is not null or b.footprint_m2 is null then
    return;
  end if;
  v_plot := round(b.plot_width_m * b.plot_length_m, 2);
  v_open := round(coalesce(v_plot, 0) - b.footprint_m2, 2);
  if v_open <= 0 or coalesce(v_rate, 0) <= 0 then
    return;
  end if;
  v_want := round(v_open * v_rate, 2);
  v_line := 'Open ground: ' || trim(to_char(v_plot, 'FM9999990.##')) || ' m² plot − ' || trim(to_char(b.footprint_m2, 'FM9999990.##'))
    || ' m² footprint = ' || trim(to_char(v_open, 'FM9999990.##')) || ' m² × ' || trim(to_char(v_rate, 'FM9999990.00')) || ' USD per m²';
  select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = b.id and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1;
  if v_inv.id is null then
    perform private.parcel_raise_invoice(b.id, 'property_bill', v_want, v_line, 'tax');
  elsif v_inv.total <> v_want and v_want >= v_inv.paid + v_inv.credited then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv.id, 'tax', 'Re-bill: ' || v_line || ' (was ' || v_inv.total || ' USD)', v_want - v_inv.total, auth.uid());
    update public.invoices set total = v_want where id = v_inv.id;
    perform private.invoice_refresh_status(v_inv.id);
  end if;
end;
$$;
revoke all on function private.building_ground_bill(uuid) from public, anon, authenticated;

/** Works out every flat's unit factor and taxable area from the building, adjusts their bills and the ground bill. */
create or replace function private.flats_apportion(p_building uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_total numeric;
  v_gross numeric;
  v_taxable numeric;
  u record;
begin
  select * into b from public.parcels where id = p_building;
  if b.id is null or b.layout <> 'flats' then
    return;
  end if;
  if b.footprint_m2 is not null and b.plot_width_m is not null and b.footprint_m2 > round(b.plot_width_m * b.plot_length_m, 2) then
    perform private.raise_app_error('VALIDATION', 'footprint');
  end if;
  select sum(own_m2) into v_total from public.parcels where parent_id = b.id and deleted_at is null;
  if coalesce(v_total, 0) <= 0 then
    return;
  end if;
  -- The whole built space: footprint × floors, never less than the flats. Without a footprint yet, each flat is
  -- billed on its own area (nothing shared) until staff enter it.
  v_gross := case when b.footprint_m2 is null then v_total else greatest(b.footprint_m2 * coalesce(b.floors, 1), v_total) end;
  -- The flats' sizes are locked; this is the system itself setting them.
  perform set_config('app.land_change', 'on', true);
  for u in select p.id, p.own_m2 from public.parcels p where p.parent_id = b.id and p.deleted_at is null loop
    v_taxable := round(u.own_m2 / v_total * v_gross, 2);
    update public.parcels
       set unit_factor = round(u.own_m2 / v_total * 10000, 2), area_m2 = v_taxable, shared_m2 = v_taxable - u.own_m2, updated_at = now()
     where id = u.id;
  end loop;
  perform set_config('app.land_change', 'off', true);
  for u in select p.id from public.parcels p where p.parent_id = b.id and p.deleted_at is null loop
    perform private.unit_bill_adjust(u.id);
  end loop;
  perform private.building_ground_bill(b.id);
end;
$$;
revoke all on function private.flats_apportion(uuid) from public, anon, authenticated;

/** A building's footprint and management (name, phone): saved, then every flat's share and the bills follow. */
create or replace function public.building_tax_setup(p_building uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_foot numeric := nullif(p ->> 'footprint_m2', '')::numeric;
  v_name text := nullif(trim(coalesce(p ->> 'manager_name', '')), '');
  v_phone text := nullif(trim(coalesce(p ->> 'manager_phone', '')), '');
begin
  if not (public.has_permission('parcels.update') or public.has_permission('valuation.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.update');
  end if;
  perform private.assert_parcel_scope(p_building);
  select * into b from public.parcels where id = p_building and deleted_at is null for update;
  if b.id is null or b.layout <> 'flats' then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v_foot is not null and (v_foot <= 0 or (b.plot_width_m is not null and v_foot > round(b.plot_width_m * b.plot_length_m, 2))) then
    perform private.raise_app_error('VALIDATION', 'footprint');
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ]{7,16}$' then
    perform private.raise_app_error('VALIDATION', 'phone');
  end if;
  update public.parcels set footprint_m2 = v_foot, manager_name = v_name, manager_phone = v_phone, updated_at = now() where id = b.id;
  perform private.flats_apportion(b.id);
  perform private.parcel_event(b.id, 'building_tax_setup', null, jsonb_build_object('footprint_m2', v_foot, 'manager', v_name));
  return (select jsonb_build_object('footprint_m2', footprint_m2, 'open_m2', round(plot_width_m * plot_length_m, 2) - coalesce(footprint_m2, round(plot_width_m * plot_length_m, 2)))
            from public.parcels where id = b.id);
end;
$$;
revoke all on function public.building_tax_setup(uuid, jsonb) from public, anon;
grant execute on function public.building_tax_setup(uuid, jsonb) to authenticated;

-- A new flats building takes its footprint and management on creation, and its flats get their shares straight away.
do $do$
declare
  d text := pg_get_functiondef('public.land_with_units_create(jsonb)'::regprocedure);
begin
  d := replace(d, $a$                              layout, floors, shared_split, units)
  values (v_ids.pun, v_ids.account_no, v_district, v_nbhd, v_house, v_type, v_use, v_land, v_width, v_length, v_geom, true,
          'draft', auth.uid(), v_layout, v_floors, case when v_layout = 'compound' then v_split end, jsonb_array_length(v_units))$a$,
    $b$                              layout, floors, shared_split, units, footprint_m2, manager_name, manager_phone)
  values (v_ids.pun, v_ids.account_no, v_district, v_nbhd, v_house, v_type, v_use, v_land, v_width, v_length, v_geom, true,
          'draft', auth.uid(), v_layout, v_floors, case when v_layout = 'compound' then v_split end, jsonb_array_length(v_units),
          case when v_layout = 'flats' then nullif(p ->> 'footprint_m2', '')::numeric end,
          case when v_layout = 'flats' then nullif(trim(coalesce(p ->> 'manager_name', '')), '') end,
          case when v_layout = 'flats' then nullif(trim(coalesce(p ->> 'manager_phone', '')), '') end)$b$);
  d := replace(d, $a$    v_bills := v_bills + private.parcel_bill(v_child);
  end loop;
$a$, $b$    v_bills := v_bills + private.parcel_bill(v_child);
  end loop;
  -- Flats: each one's share of the whole building (unit factor) and the open-ground bill to the management.
  perform private.flats_apportion(v_parent);
$b$);
  if position('footprint_m2' in d) = 0 or position('flats_apportion' in d) = 0 then
    raise exception 'land_with_units_create: text not found';
  end if;
  execute d;
end;
$do$;

-- Yearly billing: a flats building is billed for its open ground only, at the "Open ground" price (its flats are billed
-- on their own taxable areas as before).
do $do$
declare
  d text := pg_get_functiondef('private.billing_run_candidates_all(public.billing_runs)'::regprocedure);
begin
  d := replace(d, $a$           coalesce(nullif(p.plot_width_m * p.plot_length_m, 0), p.area_m2) as size_m2,
           g.amount as price$a$,
    $b$           case when p.layout = 'flats'
                then greatest(coalesce(p.plot_width_m * p.plot_length_m, 0) - coalesce(p.footprint_m2, p.plot_width_m * p.plot_length_m, 0), 0)
                else coalesce(nullif(p.plot_width_m * p.plot_length_m, 0), p.area_m2) end as size_m2,
           case when p.layout = 'flats' then (select og.amount from public.property_grades og where og.code = 'open_ground' and og.active)
                else g.amount end as price$b$);
  if position('open_ground' in d) = 0 then
    raise exception 'billing_run_candidates_all: text not found';
  end if;
  execute d;
end;
$do$;

-- Money may now go to a flats building (its open-ground bill); a shared compound still takes none itself. The other
-- rules stay as in 0161: nothing on demolished land, nothing on land not registered yet.
create or replace function private.payment_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parcel_id is null then
    return new;
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.layout = 'compound') then
    perform private.raise_app_error('CONFLICT', 'land_has_units');
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.building_state = 'demolished') then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  if exists (select 1 from public.parcels p where p.id = new.parcel_id and p.status in ('draft', 'surveyed', 'verified')) then
    perform private.raise_app_error('CONFLICT', 'bill_needs_registered');
  end if;
  return new;
end;
$$;

-- A flat's own m² changing, or a flat being deleted, changes every flat's share: work them out again.
create or replace function private.flats_reapportion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null
     and (old.own_m2 is distinct from new.own_m2 or old.deleted_at is distinct from new.deleted_at)
     -- Only once the building's footprint is known; before that a flat's own area is its whole bill, handled as before.
     and exists (select 1 from public.parcels b where b.id = new.parent_id and b.layout = 'flats' and b.deleted_at is null and b.footprint_m2 is not null) then
    perform private.flats_apportion(new.parent_id);
  end if;
  return null;
end;
$$;
revoke all on function private.flats_reapportion() from public, anon, authenticated;
create trigger flats_reapportion after update of own_m2, deleted_at on public.parcels
  for each row execute function private.flats_reapportion();
