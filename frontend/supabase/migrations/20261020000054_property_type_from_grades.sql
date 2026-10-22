-- ============================================================================
-- 0054 The type of house / land comes from Valuation → Property grades.
--
-- The separate property-types list (0046) duplicated the grades, which already
-- hold the same types with a price per m². Land now records a grade code in
-- property_type, the property bill is width × length × the grade's amount
-- (USD per m²), and the admin pages for property types and fees are gone:
-- the fee amounts (incl. the new registration fee) are set on Valuation →
-- Fee types.
-- ============================================================================

-- Records that used a property type move to the matching grade.
alter table public.applications drop constraint applications_property_type_fkey;
alter table public.parcels drop constraint parcels_property_type_fkey;
update public.applications set property_type = case property_type
    when 'cariish_baraako_jiingad' then 'cariish'
    when 'brick_stone_house_guri_diktoonow' then 'brick_house'
    when 'storey_building_dabaq' then 'storey'
    when 'empty_land_dhul_banaan' then 'warehouse'
    else property_type end
 where property_type is not null;
update public.parcels set property_type = case property_type
    when 'cariish_baraako_jiingad' then 'cariish'
    when 'brick_stone_house_guri_diktoonow' then 'brick_house'
    when 'storey_building_dabaq' then 'storey'
    when 'empty_land_dhul_banaan' then 'warehouse'
    else property_type end
 where property_type is not null;
-- Anything without a matching grade is cleared rather than left pointing nowhere.
update public.applications a set property_type = null
 where property_type is not null and not exists (select 1 from public.property_grades g where g.code = a.property_type);
update public.parcels p set property_type = null
 where property_type is not null and not exists (select 1 from public.property_grades g where g.code = p.property_type);
alter table public.applications add constraint applications_property_type_fkey
  foreign key (property_type) references public.property_grades (code) on update cascade;
alter table public.parcels add constraint parcels_property_type_fkey
  foreign key (property_type) references public.property_grades (code) on update cascade;

/** A grade switched off in Valuation can't be chosen for new or changed land (existing records keep it). */
create or replace function private.assert_property_type_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.property_type is not null
     and new.property_type is distinct from (case when tg_op = 'UPDATE' then old.property_type end)
     and not exists (select 1 from public.property_grades where code = new.property_type and active) then
    perform private.raise_app_error('VALIDATION', 'property_type_inactive');
  end if;
  return new;
end;
$$;

/** A block of flats: "apartment", "flat", "storey" or "dabaq" in the grade's code or name. */
create or replace function private.is_apartment_type(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is not null and (
    p_code ~* 'apartment|flat|storey|dabaq'
    or exists (select 1 from public.property_grades g where g.code = p_code
               and (g.name_en ~* 'apartment|flat|storey|dabaq' or g.name_so ~* 'dabaq')));
$$;

/** Raise the property bill (width × length × grade amount per m²) and the new registration fee on submit. */
create or replace function private.application_fee_invoice(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_grade public.property_grades;
  v_reg public.fee_types;
  v_area numeric;
  v_bill numeric := 0;
  v_reg_amount numeric := 0;
  v_parcel uuid;
  v_first uuid;
  v_inv uuid;
begin
  select * into v from public.applications where id = p_app;
  if v.status <> 'awaiting_payment' or v.fee_status <> 'due' then
    return null;
  end if;
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;
  if coalesce(v_grade.amount, 0) > 0 then
    if v.plot_width_m is null or v.plot_length_m is null then
      perform private.raise_app_error('VALIDATION', 'plot_size_required');
    end if;
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_bill := round(v_area * v_grade.amount, 2);
  end if;
  if v.type = 'new_registration' then
    select * into v_reg from public.fee_types where code = 'registration_fee';
    if v_reg.id is not null and v_reg.active then
      v_reg_amount := round(coalesce(v_reg.amount, 0), 2);
    end if;
  end if;
  if v_bill + v_reg_amount <= 0 then
    perform private.application_fee_settled(p_app, 'paid', 'Nothing to pay');
    return null;
  end if;
  v_parcel := private.application_draft_parcel(p_app);
  if v_parcel is null then
    return null;
  end if;
  if v_bill > 0 then
    v_first := private.application_raise_invoice(p_app, v_parcel, 'property_bill', v_bill,
      v_grade.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × ' || trim(to_char(v.plot_length_m, 'FM999990.##'))
        || ' m = ' || trim(to_char(v_area, 'FM9999990.##')) || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²');
  end if;
  if v_reg_amount > 0 then
    v_inv := private.application_raise_invoice(p_app, v_parcel, 'registration_fee', v_reg_amount, v_reg.name_en || ' — ' || v.number);
    v_first := coalesce(v_first, v_inv);
  end if;
  return v_first;
end;
$$;

-- The duplicate list and its admin functions go.
drop function public.property_type_save(uuid, jsonb);
drop function public.property_type_delete(uuid);
drop function public.fee_set_amount(uuid, numeric, boolean);
drop table public.property_types;
