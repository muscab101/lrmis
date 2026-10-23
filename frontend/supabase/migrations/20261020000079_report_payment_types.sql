-- Payments by type: for each fee type, how much came in by each way of paying (cash, mobile money, bank
-- transfer, card = Visa / Mastercard, other = cheque), with the same place filters as the other reports.
-- The Payments listing also filters by way of paying and by fee type, and shows the fee types each payment paid.

create function public.report_payment_types(p_from date, p_to date, p_district uuid default null,
                                            p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (fee_type text, fee_name_so text, fee_name_en text, payments bigint,
               cash numeric, mobile_money numeric, bank_transfer numeric, card numeric, other numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    with paid as (
      -- What each payment paid towards each fee type.
      select ft.code, ft.name_so, ft.name_en, ft.sort, p.id payment_id, p.method, a.amount
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id and p.status = 'completed'
        join public.invoices i on i.id = a.invoice_id
        join public.fee_types ft on ft.id = i.fee_type_id
        left join public.parcels pa on pa.id = i.parcel_id
       where p.received_at >= p_from and p.received_at < p_to + 1
         and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
         and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
      union all
      -- Money not yet put against a bill.
      select 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', 10000, p.id, p.method, p.unallocated
        from public.payments p
        left join public.parcels pa on pa.id = p.parcel_id
       where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
         and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
         and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
    )
    select x.code, x.name_so, x.name_en, count(distinct x.payment_id),
           coalesce(sum(x.amount) filter (where x.method = 'cash'), 0),
           coalesce(sum(x.amount) filter (where x.method = 'mobile_money'), 0),
           coalesce(sum(x.amount) filter (where x.method = 'bank_transfer'), 0),
           coalesce(sum(x.amount) filter (where x.method = 'card'), 0),
           coalesce(sum(x.amount) filter (where x.method not in ('cash', 'mobile_money', 'bank_transfer', 'card')), 0),
           sum(x.amount)
      from paid x
     group by x.code, x.name_so, x.name_en, x.sort
     order by x.sort, x.code;
end;
$$;

drop function if exists public.report_payments(date, date, uuid, uuid, uuid, uuid);

create function public.report_payments(p_from date, p_to date, p_district uuid default null,
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
  if p_method is not null and p_method not in ('cash', 'mobile_money', 'bank_transfer', 'card', 'other') then
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
       and (p_method is null
            or (p_method = 'other' and pm.method::text not in ('cash', 'mobile_money', 'bank_transfer', 'card'))
            or pm.method::text = p_method)
       and (p_fee_type is null
            or exists (select 1 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
                         join public.fee_types ft on ft.id = i.fee_type_id
                        where a.payment_id = pm.id and ft.code = p_fee_type)
            or (p_fee_type = 'credit' and pm.unallocated > 0))
     order by pm.received_at desc
     limit 10000;
end;
$$;

grant execute on function public.report_payment_types(date, date, uuid, uuid, uuid, uuid),
  public.report_payments(date, date, uuid, uuid, uuid, uuid, text, text) to authenticated;
revoke execute on function public.report_payment_types(date, date, uuid, uuid, uuid, uuid),
  public.report_payments(date, date, uuid, uuid, uuid, uuid, text, text) from public, anon;
