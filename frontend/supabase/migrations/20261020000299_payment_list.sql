-- The Payments page list (owner's request, 2026-11-28): search and filters, who paid and who took it, the totals of what
-- is shown, and pages. p: {q, status, method, channel (desk|online), district, from, to, page, size}. Desk = taken by a
-- cashier on a shift; online = the rest.
-- Only payments in the user's districts (payments.view).

create or replace function public.payment_list(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce((p ->> 'size')::int, 50), 1), 1000);
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p ->> 'q', ''), '\D', '', 'g'), '');
  v jsonb;
begin
  perform private.assert_permission('payments.view');
  with f as (
    select pm.*, pc.pun, pc.house_no, nb.code as nb_code, d.name_so as district_so, d.name_en as district_en,
           pos.code as pos_code, pos.name as pos_name,
           (select pr.full_name from public.profiles pr where pr.user_id = pm.created_by) as taken_by
      from public.payments pm
      left join public.parcels pc on pc.id = pm.parcel_id
      left join public.neighbourhoods nb on nb.id = pc.neighbourhood_id
      left join public.districts d on d.id = coalesce(pm.district_id, pc.district_id)
      left join public.points_of_sale pos on pos.id = pm.pos_id
     where (coalesce(pm.district_id, pc.district_id) is null or public.can_access_district(coalesce(pm.district_id, pc.district_id)))
       and (p ->> 'status' is null or pm.status::text = p ->> 'status')
       and (p ->> 'method' is null or pm.method::text = p ->> 'method')
       -- Desk: taken by a cashier on a shift; online: everything else (portal, pay links, providers, staff online).
       and (p ->> 'channel' is null or (p ->> 'channel' = 'desk' and pm.shift_id is not null) or (p ->> 'channel' = 'online' and pm.shift_id is null))
       and (p ->> 'district' is null or coalesce(pm.district_id, pc.district_id) = (p ->> 'district')::uuid)
       and (p ->> 'from' is null or pm.received_at >= (p ->> 'from')::date)
       and (p ->> 'to' is null or pm.received_at < (p ->> 'to')::date + 1)
       and (v_q is null
            or pm.receipt_no ilike '%' || v_q || '%' or pm.reference ilike '%' || v_q || '%' or pm.provider_ref ilike '%' || v_q || '%'
            or pc.pun ilike '%' || v_q || '%' or pc.house_no ilike v_q or pm.payer_name ilike '%' || v_q || '%'
            or (length(v_digits) >= 5 and regexp_replace(coalesce(pm.payer_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'sum', coalesce((select sum(amount_base) filter (where status <> 'reversed') from f), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'receipt_no', x.receipt_no, 'received_at', x.received_at, 'method', x.method, 'wallet', x.wallet,
        'provider', x.provider, 'provider_ref', x.provider_ref, 'reference', x.reference, 'currency', x.currency,
        'amount', x.amount, 'amount_base', x.amount_base, 'unallocated', x.unallocated, 'status', x.status,
        'payer_name', x.payer_name, 'payer_phone', x.payer_phone, 'parcel_id', x.parcel_id, 'pun', x.pun,
        'house_no', x.house_no, 'nb_code', x.nb_code, 'district_so', x.district_so, 'district_en', x.district_en,
        'pos_code', x.pos_code, 'pos_name', x.pos_name, 'taken_by', x.taken_by, 'online', x.shift_id is null)
        order by x.received_at desc)
      from (select * from f order by f.received_at desc offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
    'month', coalesce((select sum(pm.amount_base) from public.payments pm
                        where pm.status <> 'reversed' and pm.received_at >= date_trunc('month', now())
                          and (pm.district_id is null or public.can_access_district(pm.district_id))), 0))
    into v;
  return v;
end;
$$;
revoke all on function public.payment_list(jsonb) from public, anon;
grant execute on function public.payment_list(jsonb) to authenticated;
