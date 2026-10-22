-- ============================================================================
-- 0060 The two invoices on submit, as asked:
--
--  1. the property bill (width × length × the grade's price per m²) — always,
--     when the grade has a price (no longer switched off with the fee type);
--  2. for a new registration, the service charge from Valuation → Fee types
--     ("service_charge"), when it's on and above 0 — instead of the separate
--     registration fee.
--
-- Service-charge invoices of an application count with its other fee
-- invoices (payment moves it to survey; waiver / cancel drops them).
-- ============================================================================

create or replace function private.is_application_fee_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('property_bill', 'service_charge', 'registration_fee', 'application_fee');
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
  if coalesce(v_grade.amount, 0) > 0 then
    if v.plot_width_m is null or v.plot_length_m is null then
      perform private.raise_app_error('VALIDATION', 'plot_size_required');
    end if;
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_bill := round(v_area * v_grade.amount, 2);
  end if;
  if v.type = 'new_registration' then
    select * into v_reg from public.fee_types where code = 'service_charge';
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
    v_inv := private.application_raise_invoice(p_app, v_parcel, 'service_charge', v_reg_amount, v_reg.name_en || ' — ' || v.number);
    v_first := coalesce(v_first, v_inv);
  end if;
  return v_first;
end;
$$;

update public.fee_types set active = true where code = 'property_bill';

-- A new house's service charge starts at USD 12 (already so live); admins change it on Valuation → Fee types.
update public.fee_types set amount = 12 where code = 'service_charge' and amount = 0;
