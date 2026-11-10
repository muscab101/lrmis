-- The points-of-sale View (an eye icon on each row) is back: the payments behind a row, as in 0197. (A short-lived
-- migration had dropped it; it was never committed.)

-- The payments behind one row of an office's account: one cashier's (or the system's, for citizens paying online
-- themselves) at one point of sale in the period; for a district's online row, only that district's.
create or replace function public.pos_cashier_payments(p_pos uuid, p_cashier uuid, p_from date, p_to date, p_district uuid default null)
returns table (payment_id uuid, receipt_no text, received_at timestamptz, channel text, reference text, amount numeric,
               pun text, house_no text, neighbourhood text, payer text, payer_phone text, verify_status text, verified_by text, verified_at timestamptz)
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
           p.amount_base, pa.pun, pa.house_no, n.code, p.payer_name, p.payer_phone, p.verify_status, vb.full_name, p.verified_at
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
