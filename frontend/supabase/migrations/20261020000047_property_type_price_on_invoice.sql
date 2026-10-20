-- ============================================================================
-- 0047 The property type's price is billed with the application fee.
--
-- On submit, the fee invoice carries two lines: the application fee and the
-- price of the land's property type (Admin → Property types), converted to USD
-- at the day's rate when the price is in SOS. No type, or a zero price, means
-- just the fee; if both are zero there is nothing to pay and the application
-- goes straight on to survey (as before).
-- ============================================================================

create or replace function private.application_fee_invoice(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_fee public.fee_types;
  v_type public.property_types;
  v_fee_amount numeric := 0;
  v_type_amount numeric := 0;
  v_parcel uuid;
  v_district uuid;
  v_inv uuid;
begin
  select * into v from public.applications where id = p_app;
  if v.status <> 'awaiting_payment' or v.fee_status <> 'due' then
    return null;
  end if;
  select * into v_fee from public.fee_types where code = 'application_fee';
  if v_fee.id is not null and v_fee.active then
    v_fee_amount := round(coalesce(v_fee.amount, 0), 2);
  end if;
  if v.property_type is not null then
    select * into v_type from public.property_types where code = v.property_type;
    if coalesce(v_type.price, 0) > 0 then
      v_type_amount := round(v_type.price / private.fx_rate_for(v_type.currency, current_date), 2);
    end if;
  end if;
  if v_fee_amount + v_type_amount <= 0 then
    perform private.application_fee_settled(p_app, 'paid', 'No application fee');
    return null;
  end if;
  v_parcel := private.application_draft_parcel(p_app);
  if v_parcel is null then
    return null;
  end if;
  -- One fee invoice per application: an open or paid one is reused.
  select id into v_inv from public.invoices
   where parcel_id = v_parcel and fee_type_id = v_fee.id and status <> 'cancelled'
   order by created_at desc limit 1;
  if v_inv is not null then
    return v_inv;
  end if;
  select district_id into v_district from public.parcels where id = v_parcel;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), v_parcel, v_district, v_fee.id,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-application_fee-' || v_parcel),
          current_date, current_date + 30, v_fee_amount + v_type_amount, 'Application fee — ' || v.number, auth.uid())
  returning id into v_inv;
  if v_fee_amount > 0 then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv, 'fee', 'Application fee — ' || v.number, v_fee_amount, auth.uid());
  end if;
  if v_type_amount > 0 then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv, 'fee',
            'Property type: ' || v_type.name_en
              || case when v_type.currency <> 'USD' then ' (' || v_type.price || ' ' || v_type.currency || ')' else '' end,
            v_type_amount, auth.uid());
  end if;
  return v_inv;
end;
$$;
revoke all on function private.application_fee_invoice(uuid) from public, anon, authenticated;
