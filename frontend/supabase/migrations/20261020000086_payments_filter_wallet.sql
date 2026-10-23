-- The Payments report filters by wallet too (EVC Plus, eDahab, ZAAD), so collections figures open their payments;
-- "other" means the Other column (cheques and mobile money with no known wallet).

create or replace function public.report_payments(p_from date, p_to date, p_district uuid default null,
                                       p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null,
                                       p_method text default null, p_fee_type text default null)
returns table (payment_id uuid, parcel_id uuid, receipt_no text, received_at timestamptz, pun text, invoices text,
               fee_types_so text, fee_types_en text, method text, cashier text,
               point_of_sale text, payer text, amount numeric, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  if p_method is not null and p_method not in ('cash', 'evc_plus', 'edahab', 'zaad', 'mobile_money', 'bank_transfer', 'card', 'other') then
    perform private.raise_app_error('VALIDATION', 'method');
  end if;
  return query
    select pm.id, p.id, pm.receipt_no, pm.received_at, p.pun,
           (select string_agg(i.number, ', ' order by i.number) from public.payment_allocations a join public.invoices i on i.id = a.invoice_id where a.payment_id = pm.id),
           (select string_agg(distinct ft.name_so, ', ') from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
              join public.fee_types ft on ft.id = i.fee_type_id where a.payment_id = pm.id),
           (select string_agg(distinct ft.name_en, ', ') from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
              join public.fee_types ft on ft.id = i.fee_type_id where a.payment_id = pm.id),
           pm.method::text, pr.full_name, case when pos.id is null then null else pos.code || ' · ' || pos.name end,
           pm.payer_name, pm.amount, pm.status::text
      from public.payments pm
      left join public.parcels p on p.id = pm.parcel_id
      left join public.profiles pr on pr.user_id = pm.created_by
      left join public.points_of_sale pos on pos.id = pm.pos_id
     where pm.received_at >= p_from and pm.received_at < p_to + 1
       and (pm.district_id is null or public.can_access_district(pm.district_id))
       and (p_district is null or pm.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_method is null or pm.method::text = p_method or private.collection_channel(pm.method, pm.wallet) = p_method)
       and (p_fee_type is null
            or exists (select 1 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
                         join public.fee_types ft on ft.id = i.fee_type_id
                        where a.payment_id = pm.id and ft.code = p_fee_type)
            or (p_fee_type = 'credit' and pm.unallocated > 0))
     order by pm.received_at desc
     limit 10000;
end;
$$;

