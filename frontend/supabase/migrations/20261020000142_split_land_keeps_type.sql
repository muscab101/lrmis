-- Land made by a subdivision or merge keeps the property type of the land it came from. Without one it can't be priced,
-- so billing runs skipped it every year. Land already split gets the type back from its parent. A run also counts a
-- tax bill on the parent land, so split land is not charged again for a year already paid.

/** One parcel of a subdivision: the parent's PUN and House No + letter, a new account number, and its owners. */
create or replace function private.spawn_subdivided(p_template uuid, p_geom extensions.geometry, p_source text, p_letter text, p_owners jsonb)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  t public.parcels;
  v_id uuid;
  v_pun text;
  v_account int;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_owners) = 'array' then p_owners end), 0);
begin
  select * into t from public.parcels where id = p_template;
  v_pun := t.pun || p_letter;
  if exists (select 1 from public.parcels where pun = v_pun) then
    perform private.raise_app_error('CONFLICT', 'pun_taken');
  end if;
  insert into public.pun_counters (district_id) values (t.district_id) on conflict do nothing;
  update public.pun_counters set last_account = last_account + 1 where district_id = t.district_id returning last_account into v_account;
  insert into public.parcels (pun, account_no, house_no, plot_no, property_type, district_id, neighbourhood_id, street_id, ownership, land_use, developed, area_m2, perimeter_m, geom,
                              status, registered_at, registered_by, created_by)
  values (v_pun,
          private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'), '{district}{serial:7}'),
                                (select code from public.districts where id = t.district_id), (select code from public.neighbourhoods where id = t.neighbourhood_id), v_account),
          nullif(trim(t.house_no), '') || p_letter, t.plot_no, t.property_type,
          t.district_id, t.neighbourhood_id, t.street_id, t.ownership, t.land_use, t.developed,
          round(st_area(p_geom::geography)::numeric, 2), round(st_perimeter(p_geom::geography)::numeric, 2), p_geom,
          'registered', now(), auth.uid(), auth.uid())
  returning id into v_id;
  if n = 0 then
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, party_id, role, share_pct from public.parcel_owners where parcel_id = p_template and valid_to is null;
  else
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, x::uuid, (case when k = 1 then 'owner' else 'co_owner' end)::public.application_party_role,
           case when k < n then round(100.0 / n, 2) else 100 - round(100.0 / n, 2) * (n - 1) end
      from jsonb_array_elements_text(p_owners) with ordinality as e(x, k);
  end if;
  perform private.parcel_event(v_id, 'created_from', p_source, jsonb_build_object('source_parcel', p_template, 'kind', 'subdivide', 'pun', t.pun));
  return v_id;
end;
$$;

create or replace function private.spawn_parcel(p_template uuid, p_geom extensions.geometry, p_source text)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  t public.parcels;
  v_ids record;
  v_id uuid;
begin
  select * into t from public.parcels where id = p_template;
  select * into v_ids from private.next_pun(t.district_id, t.neighbourhood_id);
  insert into public.parcels (pun, account_no, property_type, district_id, neighbourhood_id, street_id, ownership, land_use, developed, area_m2, perimeter_m, geom,
                              status, registered_at, registered_by, created_by)
  values (v_ids.pun, v_ids.account_no, t.property_type, t.district_id, t.neighbourhood_id, t.street_id, t.ownership, t.land_use, t.developed,
          round(st_area(p_geom::geography)::numeric, 2), round(st_perimeter(p_geom::geography)::numeric, 2), p_geom,
          'registered', now(), auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
  select v_id, party_id, role, share_pct from public.parcel_owners where parcel_id = p_template and valid_to is null;
  perform private.parcel_event(v_id, 'created_from', p_source, jsonb_build_object('source_parcel', p_template));
  return v_id;
end;
$$;

/** This land and the land it was split from, all the way back. */
create or replace function private.parcel_lineage(p_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up(id) as (
    select p_id
    union
    select (h.data ->> 'source_parcel')::uuid
      from up join public.parcel_history h on h.parcel_id = up.id and h.action = 'created_from'
     where h.data ? 'source_parcel'
  )
  select id from up;
$$;

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
           -- A tax bill that year, on this land or the land it was split from, already covers that year.
           when v_tax and exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                                   where i.parcel_id in (select private.parcel_lineage(x.id)) and ft.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
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

update public.parcels c
   set property_type = par.property_type
  from public.parcel_history h
  join public.parcels par on par.id = (h.data ->> 'source_parcel')::uuid
 where h.parcel_id = c.id and h.action = 'created_from' and c.property_type is null and par.property_type is not null;

update public.billing_runs r set preview = private.billing_run_preview(r) where r.status in ('draft', 'submitted', 'approved');
