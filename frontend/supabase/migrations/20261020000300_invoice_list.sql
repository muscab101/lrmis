-- The Invoices page list (owner's request, 2026-11-28): owner, house and district, fee type and year, paid and
-- balance, search by owner name or house number too, filters for any fee type, district and year, sorting by balance,
-- and the totals of everything that matches (billed, paid, outstanding, overdue). Only invoices in the user's districts.
-- p: {q, filter (any|open|overdue|paid|cancelled), land (registered|partial|demolished), fee (fee type code),
--     district, period, from, to (issue date), sort (number|issue_date|due_date|total|paid|balance), dir, page, size}

create or replace function public.invoice_list(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce((p ->> 'size')::int, 25), 1), 2000);
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p ->> 'q', ''), '\D', '', 'g'), '');
  v_filter text := coalesce(p ->> 'filter', 'any');
  v_sort text := coalesce(p ->> 'sort', 'number');
  v_asc boolean := coalesce(p ->> 'dir', 'desc') = 'asc';
  v jsonb;
begin
  perform private.assert_permission('invoices.view');
  if v_sort not in ('number', 'issue_date', 'due_date', 'total', 'paid', 'balance') then
    v_sort := 'number';
  end if;
  with f as (
    select i.id, i.number, i.number_key, i.period, i.issue_date, i.due_date, i.total, i.paid, i.credited, i.balance,
           i.status::text as status, i.created_at,
           ft.code as fee_code, ft.name_so as fee_so, ft.name_en as fee_en,
           pc.id as parcel_id, pc.pun, pc.house_no, pc.account_no, pc.status::text as land_status, pc.building_state,
           nb.code as nb_code, d.name_so as district_so, d.name_en as district_en,
           (select string_agg(pa.full_name, ', ' order by po.share_pct desc nulls last, pa.full_name)
              from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = pc.id and po.valid_to is null) as owners,
           (select pa.phone from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = pc.id and po.valid_to is null and pa.phone is not null
             order by po.share_pct desc nulls last limit 1) as phone
      from public.invoices i
      left join public.fee_types ft on ft.id = i.fee_type_id
      left join public.parcels pc on pc.id = i.parcel_id
      left join public.neighbourhoods nb on nb.id = pc.neighbourhood_id
      left join public.districts d on d.id = i.district_id
     where public.can_access_district(i.district_id)
       and (v_filter = 'any'
            or (v_filter = 'open' and i.status in ('issued', 'partially_paid'))
            or (v_filter = 'overdue' and i.status in ('issued', 'partially_paid') and i.balance > 0 and i.due_date < current_date)
            or (v_filter in ('paid', 'cancelled') and i.status::text = v_filter))
       and (p ->> 'land' is null
            or (p ->> 'land' = 'partial' and pc.status in ('draft', 'surveyed', 'verified') and pc.building_state = 'standing')
            or (p ->> 'land' = 'registered' and pc.status not in ('draft', 'surveyed', 'verified') and pc.building_state = 'standing')
            or (p ->> 'land' = 'demolished' and pc.building_state = 'demolished'))
       and (p ->> 'fee' is null or ft.code = p ->> 'fee')
       and (p ->> 'district' is null or i.district_id = (p ->> 'district')::uuid)
       and (p ->> 'period' is null or i.period = p ->> 'period')
       and (p ->> 'from' is null or i.issue_date >= (p ->> 'from')::date)
       and (p ->> 'to' is null or i.issue_date <= (p ->> 'to')::date)
  ),
  s as (
    select * from f
     where v_q is null
        or f.number ilike '%' || v_q || '%' or f.pun ilike '%' || v_q || '%' or f.account_no ilike '%' || v_q || '%'
        or f.house_no ilike v_q or f.owners ilike '%' || v_q || '%'
        or (length(v_digits) >= 5 and regexp_replace(coalesce(f.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from s),
    'sums', (select jsonb_build_object(
               'billed', coalesce(sum(s.total) filter (where s.status <> 'cancelled'), 0),
               'paid', coalesce(sum(s.paid) filter (where s.status <> 'cancelled'), 0),
               'credited', coalesce(sum(s.credited) filter (where s.status <> 'cancelled'), 0),
               'outstanding', coalesce(sum(s.balance) filter (where s.status in ('issued', 'partially_paid')), 0),
               'overdue', coalesce(sum(s.balance) filter (where s.status in ('issued', 'partially_paid') and s.balance > 0 and s.due_date < current_date), 0),
               'overdue_count', count(*) filter (where s.status in ('issued', 'partially_paid') and s.balance > 0 and s.due_date < current_date))
             from s),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'number_key') from (
        select * from s
         order by
           case when v_sort = 'number' and v_asc then s.number_key end asc,
           case when v_sort = 'number' and not v_asc then s.number_key end desc,
           case when v_sort = 'issue_date' and v_asc then s.issue_date end asc,
           case when v_sort = 'issue_date' and not v_asc then s.issue_date end desc,
           case when v_sort = 'due_date' and v_asc then s.due_date end asc,
           case when v_sort = 'due_date' and not v_asc then s.due_date end desc,
           case when v_sort = 'total' and v_asc then s.total end asc,
           case when v_sort = 'total' and not v_asc then s.total end desc,
           case when v_sort = 'paid' and v_asc then s.paid end asc,
           case when v_sort = 'paid' and not v_asc then s.paid end desc,
           case when v_sort = 'balance' and v_asc then s.balance end asc,
           case when v_sort = 'balance' and not v_asc then s.balance end desc,
           s.number_key desc, s.number
         offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb))
    into v;
  return v;
end;
$$;
revoke all on function public.invoice_list(jsonb) from public, anon;
grant execute on function public.invoice_list(jsonb) to authenticated;
