-- Cashier "Push payment" is only for a bill whose money went wrong: a payment on it was reversed (the money went back
-- onto the bill), a payment was not approved (disputed), or an online payment for it failed or ran out of time.

/** Of these bills, the ones the cashier may push a payment request for. */
create or replace function public.invoices_push_allowed(p_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('cashier.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'cashier.view');
  end if;
  return coalesce((
    select array_agg(i.id)
      from public.invoices i
     where i.id = any (coalesce(p_ids, '{}'))
       and i.status in ('issued', 'partially_paid') and i.balance > 0
       and public.can_access_district(i.district_id)
       and (exists (select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
                     where a.invoice_id = i.id and (p.status = 'reversed' or p.verify_status = 'disputed'))
            or exists (select 1 from public.payment_intents x
                        where x.invoice_id = i.id and x.status in ('failed', 'cancelled', 'expired')))), '{}');
end;
$$;
revoke all on function public.invoices_push_allowed(uuid[]) from public, anon;
grant execute on function public.invoices_push_allowed(uuid[]) to authenticated;
