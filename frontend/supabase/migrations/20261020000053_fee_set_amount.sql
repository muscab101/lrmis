-- ============================================================================
-- 0053 Admins set fee amounts on Admin → Fees (settings.update), e.g. the
-- USD 12 new registration fee. The property bill has no fixed amount (it comes
-- from the property type's price per m²), so it isn't set here.
-- ============================================================================

create function public.fee_set_amount(p_id uuid, p_amount numeric, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fee_types;
begin
  perform private.assert_permission('settings.update');
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  select * into v from public.fee_types where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'fee_type');
  end if;
  if v.code = 'property_bill' then
    perform private.raise_app_error('VALIDATION', 'property_bill_from_types');
  end if;
  update public.fee_types set amount = round(p_amount, 2), active = coalesce(p_active, active) where id = p_id;
end;
$$;
revoke all on function public.fee_set_amount(uuid, numeric, boolean) from public, anon;
grant execute on function public.fee_set_amount(uuid, numeric, boolean) to authenticated;
