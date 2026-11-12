-- Cashier → To collect: each house also gives its account number and its neighbourhood's code, so the list shows the
-- full house number and the account number in their own columns.

drop function if exists public.cashier_to_collect(uuid);

create function public.cashier_to_collect(p_district uuid default null)
returns table (invoice_id uuid, invoice_number text, fee_name_so text, fee_name_en text, total numeric, balance numeric, due_date date,
               parcel_id uuid, pun text, house_no text, neighbourhood_so text, neighbourhood_en text, district_id uuid, district_so text,
               district_en text, owners text, pay_path text, account_no text, neighbourhood_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desk_district uuid;
  v_district uuid;
begin
  if not public.has_permission('cashier.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'cashier.view');
  end if;
  v_desk_district := coalesce(
    (select pos.district_id from public.cashier_shifts s join public.points_of_sale pos on pos.id = s.pos_id
      where s.cashier_id = auth.uid() and s.status = 'open' order by s.opened_at desc limit 1),
    (select pos.district_id from public.profiles pr join public.points_of_sale pos on pos.id = pr.point_of_sale_id
      where pr.user_id = auth.uid()));
  v_district := case when private.my_desk() is not null then v_desk_district else coalesce(p_district, v_desk_district) end;
  return query
    select i.id, i.number, ft.name_so, ft.name_en, i.total, i.balance, i.due_date,
           p.id, p.pun, p.house_no, n.name_so, n.name_en, d.id, d.name_so, d.name_en,
           (select string_agg(pa.full_name, ', ' order by po.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = p.id and po.valid_to is null),
           '/pay/' || t.token,
           p.account_no, n.code
      from public.invoices i
      join public.parcels p on p.id = i.parcel_id
      join public.districts d on d.id = p.district_id
      join public.fee_types ft on ft.id = i.fee_type_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join public.invoice_tokens t on t.invoice_id = i.id
     where i.status in ('issued', 'partially_paid') and i.balance > 0
       and p.deleted_at is null and p.status in ('registered', 'disputed') and p.building_state = 'standing'
       and public.can_access_district(p.district_id) and (v_district is null or p.district_id = v_district)
     order by d.name_en, n.name_en nulls last, p.house_no nulls last, p.pun, i.issue_date, i.number
     limit 2000;
end;
$$;
revoke execute on function public.cashier_to_collect(uuid) from public, anon;
grant execute on function public.cashier_to_collect(uuid) to authenticated;
