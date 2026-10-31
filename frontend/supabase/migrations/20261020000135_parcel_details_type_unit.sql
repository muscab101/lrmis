-- Editing a parcel's office details can also change its property type and its unit (flat) number. Only the keys sent
-- are changed, so a form that leaves a field out no longer wipes it. A new property type must be one of the active
-- property grades (Valuation → Property grades); the unit number only applies to apartment types (the form clears it
-- otherwise). Bills already raised keep their amounts.
create or replace function public.parcel_update_details(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_type text := nullif(trim(p ->> 'property_type'), '');
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
  update public.parcels
     set house_no = case when p ? 'house_no' then nullif(trim(p ->> 'house_no'), '') else house_no end,
         govt_receipt_no = case when p ? 'govt_receipt_no' then nullif(trim(p ->> 'govt_receipt_no'), '') else govt_receipt_no end,
         plot_no = case when p ? 'plot_no' then nullif(trim(p ->> 'plot_no'), '') else plot_no end,
         property_type = case when p ? 'property_type' then v_type else property_type end,
         flat_no = case when p ? 'flat_no' then nullif(trim(p ->> 'flat_no'), '') else flat_no end
   where id = p_id;
  perform private.parcel_event(p_id, 'details_updated', null, p);
end;
$$;
