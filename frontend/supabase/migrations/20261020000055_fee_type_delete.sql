-- ============================================================================
-- 0055 Delete a fee type (Valuation → Fee types, valuation.update).
--
-- The built-in fee types are used by the system by their code (property tax,
-- service charge, the registration fee and property bill, certificate, …) and
-- can only be switched off. A fee type already on an invoice or a billing run
-- is switched off instead of deleted, so those keep it; an unused one is
-- removed. Returns 'deleted' or 'hidden'.
-- ============================================================================

create function public.valuation_delete_fee_type(p_id uuid)
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
                'building_permit', 'registration_fee', 'property_bill') then
    perform private.raise_app_error('CONFLICT', 'fee_built_in');
  end if;
  if exists (select 1 from public.invoices where fee_type_id = p_id)
     or exists (select 1 from public.billing_runs where fee_type_id = p_id) then
    update public.fee_types set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.fee_types where id = p_id;
  return 'deleted';
end;
$$;
revoke all on function public.valuation_delete_fee_type(uuid) from public, anon;
grant execute on function public.valuation_delete_fee_type(uuid) to authenticated;
