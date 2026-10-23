-- Desk users only ever see their own desk: a user assigned to a point of sale who does not cover every district gets
-- only that desk's payments in the money reports and the collections figures, whatever filter is asked for.
-- Cashiers can open Yet to register (it needs parcels.view).

/** The caller's desk when they are tied to one (assigned a point of sale and not district-wide), else null. */
create or replace function private.my_desk()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.user_has_all_districts(auth.uid()) then null
              else (select point_of_sale_id from public.profiles where user_id = auth.uid()) end;
$$;

/** May the caller see a payment taken at this desk, given the desk filter asked for? */
create or replace function private.desk_ok(p_payment_pos uuid, p_pos uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.my_desk() is not null then p_payment_pos is not distinct from private.my_desk()
              else p_pos is null or p_payment_pos = p_pos end;
$$;

/** The desk the caller is tied to, so the app can fix the filter. */
create or replace function public.my_scope()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'all', private.user_has_all_districts(auth.uid()),
    'district_ids', to_jsonb(private.user_district_ids(auth.uid())),
    'locked', private.my_desk() is not null,
    'pos', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'district_id', s.district_id)
              from public.profiles p join public.points_of_sale s on s.id = p.point_of_sale_id where p.user_id = auth.uid()));
$$;

/** Payments in a period for the collections reports, with their column (channel). */
create or replace function private.collection_rows(p_from date, p_to date, p_basis text, p_district uuid,
                                                   p_section uuid, p_sector uuid, p_neighbourhood uuid, p_pos uuid)
returns table (id uuid, received_at timestamptz, created_by uuid, channel text, amount numeric, verify_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.received_at, p.created_by, private.collection_channel(p.method, p.wallet), p.amount_base, p.verify_status
    from public.payments p
    left join public.parcels pa on pa.id = p.parcel_id
   where p.status <> 'reversed' and p.received_at >= p_from and p.received_at < p_to + 1
     and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
     and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     and (coalesce(p_basis, 'verified') = 'all' or p.verify_status in ('verified', 'reconciled'))
     and private.desk_ok(p.pos_id, p_pos);
$$;

/** Payments not yet reconciled (pending, verified or disputed), oldest first. */
create or replace function public.report_unreconciled(p_from date, p_to date, p_district uuid default null,
                                                      p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null, p_pos uuid default null)
returns table (payment_id uuid, parcel_id uuid, receipt_no text, received_at timestamptz, cashier text, channel text, reference text,
               pun text, amount numeric, verify_status text, age_days int, dispute_reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select p.id, pa.id, p.receipt_no, p.received_at, coalesce(pr.full_name, 'Online'), private.collection_channel(p.method, p.wallet),
           coalesce(p.reference, p.provider_ref), pa.pun, p.amount_base, p.verify_status, (current_date - p.received_at::date)::int, p.dispute_reason
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.profiles pr on pr.user_id = p.created_by
     where p.status <> 'reversed' and p.verify_status <> 'reconciled' and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
       and private.in_area(pa.neighbourhood_id, p_section, p_sector, p_neighbourhood)
       and private.desk_ok(p.pos_id, p_pos)
     order by p.received_at
     limit 10000;
end;
$$;

create or replace function public.report_payments(p_from date, p_to date, p_district uuid default null,
                                       p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null,
                                       p_method text default null, p_fee_type text default null, p_pos uuid default null)
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
       and private.desk_ok(pm.pos_id, p_pos)
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

revoke all on function private.my_desk(), private.desk_ok(uuid, uuid) from public, anon, authenticated;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'parcels.view' from public.roles r where r.key = 'cashier'
on conflict do nothing;
