-- ============================================================================
-- 0057 Delete on every fee type row.
--
-- The built-in fee types are used by the system by their code, so "delete"
-- switches them off instead (they can be switched on again with Edit). A
-- switched-off property bill is no longer charged when land is submitted
-- (the registration fee already honoured its on/off switch).
-- ============================================================================

create or replace function public.valuation_delete_fee_type(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fee_types;
begin
  perform private.assert_permission('valuation.update');
  select * into v from public.fee_types where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'fee_type');
  end if;
  if v.code in ('property_tax', 'service_charge', 'application_fee', 'certificate_fee', 'transfer_stamp_duty',
                'building_permit', 'registration_fee', 'property_bill')
     or exists (select 1 from public.invoices where fee_type_id = p_id)
     or exists (select 1 from public.billing_runs where fee_type_id = p_id) then
    update public.fee_types set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.fee_types where id = p_id;
  return 'deleted';
end;
$$;

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
  if coalesce(v_grade.amount, 0) > 0
     and exists (select 1 from public.fee_types where code = 'property_bill' and active) then
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
