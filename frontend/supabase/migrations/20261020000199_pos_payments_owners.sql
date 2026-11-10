-- The payments behind a cashier's row now also name the land's owners, for the Point of sale page's list per way of
-- paying ("every owner who paid by ZAAD").

drop function if exists public.pos_cashier_payments(uuid, uuid, date, date, uuid);

create function public.pos_cashier_payments(p_pos uuid, p_cashier uuid, p_from date, p_to date, p_district uuid default null)
returns table (payment_id uuid, receipt_no text, received_at timestamptz, channel text, reference text, amount numeric,
               pun text, house_no text, neighbourhood text, owners text, payer text, payer_phone text,
               verify_status text, verified_by text, verified_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  perform private.assert_report(p_from, p_to);
  return query
    select p.id, p.receipt_no, p.received_at, private.collection_channel(p.method, p.wallet), coalesce(p.reference, p.provider_ref),
           p.amount_base, pa.pun, pa.house_no, n.code,
           (select string_agg(o.full_name, ', ' order by o.full_name)
              from public.parcel_owners po join public.parties o on o.id = po.party_id
             where po.parcel_id = pa.id and po.valid_to is null),
           p.payer_name, p.payer_phone, p.verify_status, vb.full_name, p.verified_at
      from public.payments p
      left join public.parcels pa on pa.id = p.parcel_id
      left join public.neighbourhoods n on n.id = pa.neighbourhood_id
      left join public.profiles vb on vb.user_id = p.verified_by
     where p.pos_id = p_pos and p.created_by is not distinct from p_cashier and p.status <> 'reversed'
       and (p_district is null or p.district_id = p_district)
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
     order by p.received_at desc
     limit 1000;
end;
$$;
revoke all on function public.pos_cashier_payments(uuid, uuid, date, date, uuid) from public, anon;
grant execute on function public.pos_cashier_payments(uuid, uuid, date, date, uuid) to authenticated;
