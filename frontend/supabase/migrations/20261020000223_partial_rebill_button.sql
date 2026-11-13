-- Partial land: a new size or type no longer changes the bill by itself. After the edit, staff see what the bill is and
-- what it would be now, and press Re-bill (and then Approve to register the land).

-- 1. What the land's property bill would be from its size and type now (nothing when there is no size or price).
create or replace function private.parcel_bill_expected(p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_area numeric;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.layout <> 'house' or v.status not in ('draft', 'surveyed', 'verified') or v.property_type is null then
    return null;
  end if;
  select * into v_grade from public.property_grades where code = v.property_type;
  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);
  v_area := case when v.parent_id is not null then v.area_m2 else round(v.plot_width_m * v.plot_length_m, 2) end;
  if coalesce(v_grade.amount, 0) <= 0 or coalesce(v_area, 0) <= 0 then
    return null;
  end if;
  return jsonb_build_object('amount', round(v_area * v_grade.amount, 2), 'area', v_area, 'price', v_grade.amount,
                            'type_so', v_grade.name_so, 'type_en', v_grade.name_en);
end;
$$;
revoke all on function private.parcel_bill_expected(uuid) from public, anon, authenticated;

-- 2. The bill now against the bill the size and type give: shown after an edit, with Re-bill when they differ.
create or replace function public.parcel_bill_check(p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_inv public.invoices;
  e jsonb;
begin
  perform private.assert_permission('parcels.view');
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  e := private.parcel_bill_expected(p_parcel);
  if e is null then
    return null;
  end if;
  select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = p_parcel and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1;
  return jsonb_build_object(
    'invoice', case when v_inv.id is not null then jsonb_build_object('id', v_inv.id, 'number', v_inv.number, 'total', v_inv.total,
                 'paid', v_inv.paid + v_inv.credited) end,
    'expected', e,
    'differs', v_inv.id is null or v_inv.total <> (e ->> 'amount')::numeric,
    'below_paid', v_inv.id is not null and (e ->> 'amount')::numeric < v_inv.paid + v_inv.credited);
end;
$$;
revoke all on function public.parcel_bill_check(uuid) from public, anon;
grant execute on function public.parcel_bill_check(uuid) to authenticated;

-- 3. Re-bill: the unpaid bill follows the land's size and type now.
create or replace function public.parcel_rebill_now(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  perform private.assert_permission('parcels.update');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  if v.status not in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'registered_size_fixed');
  end if;
  if private.parcel_bill_expected(p_parcel) is null then
    perform private.raise_app_error('VALIDATION', 'plot_size_required');
  end if;
  perform private.parcel_rebill(p_parcel);
  return public.parcel_bill_check(p_parcel);
end;
$$;
revoke all on function public.parcel_rebill_now(uuid) from public, anon;
grant execute on function public.parcel_rebill_now(uuid) to authenticated;

-- 4. Saving the land no longer re-bills it by itself (the Re-bill button does).
do $$
declare
  d text := pg_get_functiondef('public.parcel_update_details(uuid,jsonb)'::regprocedure);
  a text := '  -- Land not registered yet: its unpaid bill follows a new size or type. Other changes leave it alone.
  if v_partial and ((p ? ''property_type'' and v_type is distinct from v.property_type)
                    or (v_width is not null and (v_width, v_length) is distinct from (v.plot_width_m, v.plot_length_m))
                    or (v_own is not null and v_own is distinct from v.own_m2)) then
    perform private.parcel_rebill(p_id);
  end if;
';
begin
  if position(a in d) = 0 then
    raise exception 'parcel_update_details: re-bill block not found';
  end if;
  execute replace(d, a, '  -- Land not registered yet: a new size or type is re-billed with the Re-bill button (parcel_rebill_now).
');
end $$;
