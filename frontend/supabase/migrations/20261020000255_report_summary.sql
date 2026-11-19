-- Reports → "Less data": the key figures of a period on one page (land, owners, bills, money, documents), for the
-- viewer's districts or one of them. Money in and out comes from report_income_expense (the books); this adds the counts.
-- Land is counted per house: a house on its own or one flat / compound house (a building itself is not counted).

create or replace function public.report_summary(p_from date, p_to date, p_district uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := private.viewer_sees_all_districts();
  v_dists uuid[] := private.viewer_district_ids();
  v_end timestamptz := (p_to + 1)::timestamptz;
  v jsonb;
begin
  perform private.assert_report(p_from, p_to);
  with land as (
    select p.* from public.parcels p
     where p.deleted_at is null and p.layout = 'house'
       and (v_all or p.district_id = any (v_dists)) and (p_district is null or p.district_id = p_district)
  ), bills as (
    select i.* from public.invoices i
     where i.status <> 'cancelled'
       and (v_all or i.district_id = any (v_dists)) and (p_district is null or i.district_id = p_district)
  ), pays as (
    select y.* from public.payments y
     where y.status = 'completed' and y.received_at >= p_from and y.received_at < v_end
       and ((y.district_id is null and v_all and p_district is null)
            or ((v_all or y.district_id = any (v_dists)) and (p_district is null or y.district_id = p_district)))
  ), holders as (
    select po.party_id, min(p.registered_at) as first_registered
      from public.parcel_owners po join land p on p.id = po.parcel_id
     where po.valid_to is null
     group by 1
  )
  select jsonb_build_object(
    'land_registered', (select count(*) from land where status in ('registered', 'disputed') and building_state = 'standing'),
    'land_registered_new', (select count(*) from land where status in ('registered', 'disputed') and registered_at >= p_from and registered_at < v_end),
    'land_partial', (select count(*) from land where status in ('draft', 'surveyed', 'verified')),
    'land_demolished', (select count(*) from land where building_state = 'demolished'),
    'land_to_check', (select count(*) from land where site_check_status = 'pending'),
    'owners', (select count(*) from holders h join public.parties a on a.id = h.party_id where a.deleted_at is null),
    'owners_new', (select count(*) from holders h join public.parties a on a.id = h.party_id
                    where a.deleted_at is null and a.created_at >= p_from and a.created_at < v_end),
    'bills_issued', (select count(*) from bills where issue_date between p_from and p_to),
    'billed', (select coalesce(sum(total), 0) from bills where issue_date between p_from and p_to),
    'bills_paid', (select count(*) from bills where issue_date between p_from and p_to and status = 'paid'),
    'outstanding', (select coalesce(sum(balance), 0) from bills where status in ('issued', 'partially_paid')),
    'overdue', (select coalesce(sum(balance), 0) from bills where status in ('issued', 'partially_paid') and due_date < current_date),
    'payments', (select count(*) from pays),
    'collected', (select coalesce(sum(amount_base), 0) from pays),
    'certificates', (select count(*) from public.issued_documents d
                      where d.type = 'certificate' and d.issued_at >= p_from and d.issued_at < v_end
                        and (v_all or d.district_id = any (v_dists)) and (p_district is null or d.district_id = p_district)),
    'transfers', (select count(*) from public.transfers t
                   where t.status = 'approved' and t.decided_at >= p_from and t.decided_at < v_end
                     and (v_all or t.district_id = any (v_dists)) and (p_district is null or t.district_id = p_district))
  ) into v;
  return v;
end;
$$;
revoke all on function public.report_summary(date, date, uuid) from public, anon;
grant execute on function public.report_summary(date, date, uuid) to authenticated;
