-- A run's batches also give their district, section and sector, so the run page can filter batches by place.
drop function if exists public.billing_run_batches(uuid);

/** A run's bills in batches: one row per neighbourhood with its count and total (bills made, or the preview). */
create or replace function public.billing_run_batches(p_id uuid)
returns table (neighbourhood_id uuid, neighbourhood_code text, neighbourhood_so text, neighbourhood_en text,
               section_so text, section_en text, district_so text, district_en text,
               bills int, total numeric, skipped int,
               district_id uuid, section_id uuid, section_code text, sector_id uuid, sector_code text, sector_so text, sector_en text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.view');
  v := private.billing_run_scope(p_id);
  return query
  with items as (
    select i.parcel_id, i.total as amount, null::text as exception from public.invoices i where v.status = 'issued' and i.run_id = p_id
    union all
    select c.parcel_id, c.amount, c.exception from private.billing_run_candidates(v) c where v.status <> 'issued'
  )
  select n.id, n.code, n.name_so, n.name_en, sec.name_so, sec.name_en, d.name_so, d.name_en,
         (count(*) filter (where it.exception is null))::int,
         coalesce(sum(it.amount) filter (where it.exception is null), 0),
         (count(*) filter (where it.exception is not null))::int,
         d.id, sec.id, sec.code, sc.id, sc.code, sc.name_so, sc.name_en
  from items it
  join public.parcels p on p.id = it.parcel_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.sectors sc on sc.id = n.sector_id
  left join public.sections sec on sec.id = sc.section_id
  left join public.districts d on d.id = p.district_id
  group by n.id, n.code, n.name_so, n.name_en, sec.name_so, sec.name_en, d.name_so, d.name_en,
           d.id, sec.id, sec.code, sc.id, sc.code, sc.name_so, sc.name_en
  order by d.name_en, sec.name_en, n.code;
end;
$$;
