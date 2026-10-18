-- ============================================================================
-- 0039 search_parcels returns the plot number, so editing a parcel from the
-- Parcels table starts from its saved plot number instead of a blank one.
-- ============================================================================

drop function public.search_parcels(text, int);
create function public.search_parcels(p_q text, p_limit int default 20)
returns table (id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text,
               created_at timestamptz, house_no text, govt_receipt_no text, invoice text, balance numeric,
               locked_at timestamptz, lock_reason text, application_number text, district_en text, neighbourhood_en text, plot_no text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         coalesce(
           (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = p.id and po.valid_to is null),
           (select string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) from public.application_parties ap
              join public.parties pa on pa.id = ap.party_id
             where ap.application_id = p.application_id and ap.role in ('owner', 'co_owner'))),
         p.created_at, p.house_no, p.govt_receipt_no,
         (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
          order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1),
         (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid')),
         p.locked_at, p.lock_reason, a.number, d.name_en, n.name_en, p.plot_no
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.applications a on a.id = p.application_id
  where p.deleted_at is null and p.status <> 'archived'
    and (coalesce(trim(p_q), '') = ''
         or p.pun ilike '%' || trim(p_q) || '%'
         or p.account_no ilike trim(p_q) || '%'
         or p.house_no ilike trim(p_q) || '%'
         or p.govt_receipt_no ilike trim(p_q) || '%'
         or a.number ilike trim(p_q) || '%'
         or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
         or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                    where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%')
         or exists (select 1 from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                    where ap.application_id = p.application_id and pa.full_name ilike '%' || trim(p_q) || '%'))
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_parcels(text, int) from public, anon;
grant execute on function public.search_parcels(text, int) to authenticated;
