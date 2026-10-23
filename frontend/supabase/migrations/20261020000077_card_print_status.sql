-- The print page and the ID cards list check an ID card's print payment before anyone tries to print:
-- whether the card fee is on, and the card's print bill (number and state). Print officers can't read
-- invoices, so this returns just that much.

create or replace function public.card_print_status(p_ids uuid[])
returns table (id uuid, fee_on boolean, invoice_number text, invoice_status text, paid boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_on boolean := (private.card_fee()).id is not null;
begin
  if not public.has_permission('certificates.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'certificates.view');
  end if;
  return query
    select d.id, v_on, i.number, i.status::text, coalesce(i.status = 'paid', false)
      from public.issued_documents d
      left join public.invoices i on i.id = d.print_fee_invoice_id
     where d.id = any (p_ids) and d.type = 'id_card' and public.can_access_district(d.district_id);
end;
$$;

grant execute on function public.card_print_status(uuid[]) to authenticated;
revoke execute on function public.card_print_status(uuid[]) from public, anon;
