-- Cashier → To collect: every registered house in the cashier's districts that still owes money, one row
-- per unpaid bill, with its pay link (for a card payment through Stripe). Paying the bills marks them
-- paid; when everything is paid the certificate is issued as before, and the house leaves the list.

create or replace function public.cashier_to_collect(p_district uuid default null)
returns table (invoice_id uuid, invoice_number text, fee_name_so text, fee_name_en text, total numeric, balance numeric, due_date date,
               parcel_id uuid, pun text, house_no text, neighbourhood_so text, neighbourhood_en text, district_id uuid,
               district_so text, district_en text, owners text, pay_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('cashier.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'cashier.view');
  end if;
  return query
    select i.id, i.number, ft.name_so, ft.name_en, i.total, i.balance, i.due_date,
           p.id, p.pun, p.house_no, n.name_so, n.name_en, d.id, d.name_so, d.name_en,
           (select string_agg(pa.full_name, ', ' order by po.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = p.id and po.valid_to is null),
           '/pay/' || t.token
      from public.invoices i
      join public.parcels p on p.id = i.parcel_id
      join public.districts d on d.id = p.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join public.invoice_tokens t on t.invoice_id = i.id
     where i.status in ('issued', 'partially_paid') and i.balance > 0
       and p.deleted_at is null and p.status in ('registered', 'disputed')
       and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)
     order by d.name_en, n.name_en nulls last, p.house_no nulls last, p.pun, i.issue_date, i.number
     limit 2000;
end;
$$;

grant execute on function public.cashier_to_collect(uuid) to authenticated;
revoke execute on function public.cashier_to_collect(uuid) from public, anon;
