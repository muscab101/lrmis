-- Edit a land's upper storeys (land edit form). Partial land is billed again; registered land gets a line for the
-- difference on its open tax invoice of this year (the next yearly bills count the new number anyway).

create or replace function public.parcel_set_upper_storeys(p_parcel uuid, p_storeys int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_before numeric;
  v_after numeric;
  v_inv public.invoices;
begin
  perform private.assert_permission('parcels.update');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if p_storeys is null or p_storeys not between 0 and 100 then
    perform private.raise_app_error('VALIDATION', 'upper_storeys');
  end if;
  if v.layout <> 'house' or v.parent_id is not null then
    perform private.raise_app_error('VALIDATION', 'upper_storeys_land');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  if v.status = 'archived' or v.building_state <> 'standing' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if coalesce(v.upper_storeys, 0) = p_storeys then
    return jsonb_build_object('changed', false);
  end if;

  v_before := private.upper_storeys_amount(p_parcel);
  update public.parcels set upper_storeys = p_storeys, updated_at = now() where id = p_parcel;
  v_after := private.upper_storeys_amount(p_parcel);

  if v.status in ('draft', 'surveyed', 'verified') then
    perform private.parcel_rebill(p_parcel);
  elsif v_after <> v_before then
    select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
     where i.parcel_id = p_parcel and f.code in ('property_bill', 'property_tax') and i.status in ('issued', 'partially_paid')
       and extract(year from i.issue_date) = extract(year from now())
     order by i.issue_date desc, i.created_at desc limit 1;
    if v_inv.id is not null then
      if v_inv.total + (v_after - v_before) < v_inv.paid + v_inv.credited then
        perform private.raise_app_error('CONFLICT', 'rebill_below_paid');
      end if;
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (v_inv.id, 'tax', 'Upper storeys changed from ' || coalesce(v.upper_storeys, 0) || ' to ' || p_storeys
              || coalesce(': ' || private.upper_storeys_line(p_parcel), ''), v_after - v_before, auth.uid());
      update public.invoices set total = total + (v_after - v_before) where id = v_inv.id;
      perform private.invoice_refresh_status(v_inv.id);
    end if;
  end if;
  perform private.parcel_event(p_parcel, 'upper_storeys_changed', null,
    jsonb_build_object('from', coalesce(v.upper_storeys, 0), 'to', p_storeys, 'invoice', v_inv.number));
  return jsonb_build_object('changed', true, 'invoice', v_inv.number, 'difference', v_after - v_before);
end;
$$;

revoke all on function public.parcel_set_upper_storeys(uuid, int) from public, anon;
grant execute on function public.parcel_set_upper_storeys(uuid, int) to authenticated;
