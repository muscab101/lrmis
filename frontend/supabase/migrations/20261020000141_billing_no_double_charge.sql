-- Billing runs must not charge land twice. The tax bill made at registration is a different fee with a dated period, so
-- a property tax run did not see it: land billed at registration in a year is now skipped for that year. A run also
-- skips land for years before it was registered. Saved previews of runs not yet issued are refreshed.

create or replace function private.billing_run_candidates(p_run public.billing_runs)
returns table (parcel_id uuid, district_id uuid, assessment_id uuid, amount numeric, lines jsonb, exception text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fee public.fee_types;
  v_tax boolean;
begin
  select * into v_fee from public.fee_types where id = p_run.fee_type_id;
  v_tax := v_fee.code in ('property_tax', 'property_bill');
  return query
  with scope as (
    select p.id, p.district_id, p.pun,
           p.registered_at,
           coalesce(nullif(p.plot_width_m * p.plot_length_m, 0), p.area_m2) as size_m2,
           g.amount as price
    from public.parcels p
    left join public.neighbourhoods n on n.id = p.neighbourhood_id
    left join public.sectors sc on sc.id = n.sector_id
    left join public.property_grades g on g.code = p.property_type
    where p.deleted_at is null and p.status in ('registered', 'disputed')
      and p.district_id = any (p_run.district_ids)
      and ((cardinality(p_run.neighbourhood_ids) = 0 and cardinality(p_run.sector_ids) = 0 and cardinality(p_run.section_ids) = 0)
           or p.neighbourhood_id = any (p_run.neighbourhood_ids)
           or n.sector_id = any (p_run.sector_ids)
           or sc.section_id = any (p_run.section_ids))
  ), priced as (
    select s.*, a.id as a_id, a.number as a_number, a.total as a_total, a.service_charge as a_service,
           case when s.size_m2 > 0 and s.price is not null then round(s.size_m2 * s.price, 2) end as auto_amount
    from scope s
    left join public.assessments a on a.parcel_id = s.id and a.year = p_run.year and a.status = 'issued'
  )
  select x.id, x.district_id, x.a_id,
         case when not v_tax then v_fee.amount when x.a_id is not null then x.a_total else x.auto_amount end,
         case when not v_tax then
                jsonb_build_array(jsonb_build_object('kind', 'fee', 'description', v_fee.name_en || ' ' || p_run.period, 'amount', v_fee.amount))
              when x.a_id is not null then
                jsonb_build_array(
                  jsonb_build_object('kind', 'tax', 'description', 'Property tax ' || p_run.period || ' (' || x.a_number || ')',
                                     'amount', x.a_total - x.a_service),
                  jsonb_build_object('kind', 'service', 'description', 'Service charge ' || p_run.period, 'amount', x.a_service))
              else
                jsonb_build_array(jsonb_build_object('kind', 'tax',
                  'description', 'Property tax ' || p_run.period || ' (' || round(x.size_m2, 1) || ' m² × ' || x.price || ')',
                  'amount', x.auto_amount))
         end,
         case
           when exists (select 1 from public.invoices i where i.parcel_id = x.id and i.fee_type_id = p_run.fee_type_id and i.period = p_run.period) then 'already_invoiced'
           -- The tax bill made at registration already covers that year.
           when v_tax and exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                                   where i.parcel_id = x.id and ft.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
                                     and extract(year from i.issue_date) = p_run.year) then 'already_invoiced'
           -- No tax for a year before the land was registered.
           when v_tax and extract(year from x.registered_at) > p_run.year then 'not_registered_yet'
           when v_tax and x.a_id is null and x.auto_amount is null then 'no_assessment'
           when (case when not v_tax then v_fee.amount when x.a_id is not null then x.a_total else x.auto_amount end) <= 0 then 'zero_amount'
           else null
         end
  from priced x;
end;
$$;

create or replace function private.billing_run_preview(p_run public.billing_runs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'parcels', count(*),
    'count', count(*) filter (where exception is null),
    'total', coalesce(sum(amount) filter (where exception is null), 0),
    'exceptions', jsonb_build_object(
      'already_invoiced', count(*) filter (where exception = 'already_invoiced'),
      'not_registered_yet', count(*) filter (where exception = 'not_registered_yet'),
      'no_assessment', count(*) filter (where exception = 'no_assessment'),
      'zero_amount', count(*) filter (where exception = 'zero_amount')),
    'at', now())
  from private.billing_run_candidates(p_run);
$$;

update public.billing_runs r set preview = private.billing_run_preview(r) where r.status in ('draft', 'submitted', 'approved');
