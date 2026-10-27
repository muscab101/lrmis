-- Revenue report: narrow it by the payment's check status (verified, reconciled, pending = not checked, disputed) and
-- by the bill's status (paid, partially_paid, issued = unpaid), and a detail view with one line per payment.
-- Unallocated credit belongs to no bill, so it is left out when a bill status is chosen.
drop function if exists public.report_revenue(date, date, uuid, uuid, uuid, uuid);

create or replace function public.report_revenue(p_from date, p_to date, p_district uuid default null, p_section uuid default null,
                                                 p_sector uuid default null, p_neighbourhood uuid default null,
                                                 p_check_status text default null, p_bill_status text default null)
returns table (month text, fee_type text, fee_name_so text, fee_name_en text, amount numeric, payments bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), ft.code, ft.name_so, ft.name_en, sum(a.amount)::numeric, count(distinct p.id)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.status = 'completed'
      join public.invoices i on i.id = a.invoice_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels pa on pa.id = i.parcel_id
     where p.received_at >= p_from and p.received_at < p_to + 1
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_check_status is null or p.verify_status = p_check_status)
       and (p_bill_status is null or i.status::text = p_bill_status)
     group by 1, 2, 3, 4
    union all
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', sum(p.unallocated)::numeric, count(*)
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
     where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_check_status is null or p.verify_status = p_check_status)
       and p_bill_status is null
     group by 1
     order by 1, 2;
end;
$$;

/** The Revenue report one payment (and bill it paid) per line, newest first, with the same filters. */
create or replace function public.report_revenue_detail(p_from date, p_to date, p_district uuid default null, p_section uuid default null,
                                                        p_sector uuid default null, p_neighbourhood uuid default null,
                                                        p_check_status text default null, p_bill_status text default null)
returns table (received_at timestamptz, receipt_no text, pun text, payer text, fee_type text, fee_name_so text, fee_name_en text,
               invoice_number text, bill_status text, check_status text, channel text, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select p.received_at, p.receipt_no, pa.pun, p.payer_name, ft.code, ft.name_so, ft.name_en, i.number, i.status::text, p.verify_status,
           private.collection_channel(p.method, p.wallet), a.amount::numeric
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.status = 'completed'
      join public.invoices i on i.id = a.invoice_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels pa on pa.id = i.parcel_id
     where p.received_at >= p_from and p.received_at < p_to + 1
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_check_status is null or p.verify_status = p_check_status)
       and (p_bill_status is null or i.status::text = p_bill_status)
    union all
    select p.received_at, p.receipt_no, pa.pun, p.payer_name, 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', null, null, p.verify_status,
           private.collection_channel(p.method, p.wallet), p.unallocated::numeric
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
     where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and (p_check_status is null or p.verify_status = p_check_status)
       and p_bill_status is null
     order by 1 desc, 2;
end;
$$;

revoke all on function public.report_revenue(date, date, uuid, uuid, uuid, uuid, text, text),
  public.report_revenue_detail(date, date, uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.report_revenue(date, date, uuid, uuid, uuid, uuid, text, text),
  public.report_revenue_detail(date, date, uuid, uuid, uuid, uuid, text, text) to authenticated;
