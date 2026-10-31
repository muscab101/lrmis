-- Billing runs, made easier (owner decisions 2026-10-31):
--  * A run can cover chosen sections, sectors and neighbourhoods inside its districts (none chosen = whole districts).
--  * Property tax works itself out: when the land has no valuation assessment for the year, the bill is its size
--    (width × length, else its area) × the price per m² of its property type (Valuation → Property grades), like
--    the tax bill made at registration. Land with no size or type is skipped and counted.
--  * "Issue now": whoever makes a run can issue its bills straight away, without the finance approval step.
--  * Every 1 January the system makes and issues that year's property tax run for each district with registered land.
--  * A run's bills can be viewed in batches, one per neighbourhood (with its section and district).

alter table public.billing_runs
  add column if not exists section_ids uuid[] not null default '{}',
  add column if not exists sector_ids uuid[] not null default '{}',
  add column if not exists automatic boolean not null default false;

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
           when v_tax and x.a_id is null and x.auto_amount is null then 'no_assessment'
           when (case when not v_tax then v_fee.amount when x.a_id is not null then x.a_total else x.auto_amount end) <= 0 then 'zero_amount'
           else null
         end
  from priced x;
end;
$$;

create or replace function public.billing_run_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
  v_year int := (p ->> 'year')::int;
  v_fee uuid := (p ->> 'fee_type_id')::uuid;
  v_districts uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'district_ids', '[]'))::uuid);
  v_nbhds uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'neighbourhood_ids', '[]'))::uuid);
  v_sections uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'section_ids', '[]'))::uuid);
  v_sectors uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'sector_ids', '[]'))::uuid);
  v_d uuid;
  v_due date := nullif(p ->> 'due_date', '')::date;
begin
  perform private.assert_permission('billing.create');
  if v_year is null or v_year < 2000 or v_year > 2100 then
    perform private.raise_app_error('VALIDATION', 'year');
  end if;
  if not exists (select 1 from public.fee_types where id = v_fee and active and interval <> 'one_off') then
    perform private.raise_app_error('VALIDATION', 'fee_type');
  end if;
  if cardinality(v_districts) = 0 then
    perform private.raise_app_error('VALIDATION', 'districts');
  end if;
  foreach v_d in array v_districts loop
    if not public.can_access_district(v_d) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end loop;
  if exists (select 1 from unnest(v_nbhds) n where not exists (
               select 1 from public.neighbourhoods x where x.id = n and x.district_id = any (v_districts))) then
    perform private.raise_app_error('VALIDATION', 'neighbourhoods');
  end if;
  if exists (select 1 from unnest(v_sections) x where not exists (
               select 1 from public.sections y where y.id = x and y.district_id = any (v_districts)))
     or exists (select 1 from unnest(v_sectors) x where not exists (
               select 1 from public.sectors y join public.sections z on z.id = y.section_id where y.id = x and z.district_id = any (v_districts))) then
    perform private.raise_app_error('VALIDATION', 'places');
  end if;
  v_due := coalesce(v_due, current_date + private.setting_int('billing.due_days', 60));
  if v_due < current_date then
    perform private.raise_app_error('VALIDATION', 'due_date');
  end if;

  insert into public.billing_runs (number, year, period, fee_type_id, district_ids, section_ids, sector_ids, neighbourhood_ids, due_date, note, created_by)
  values ('BR-' || v_year || '-' || lpad(private.next_serial('BR-' || v_year)::text, 3, '0'), v_year,
          coalesce(nullif(p ->> 'period', ''), v_year::text), v_fee, v_districts, v_sections, v_sectors, v_nbhds, v_due,
          nullif(trim(p ->> 'note'), ''), auth.uid())
  returning * into v;
  update public.billing_runs set preview = private.billing_run_preview(v) where id = v.id returning * into v;
  return jsonb_build_object('id', v.id, 'number', v.number, 'preview', v.preview);
end;
$$;

/** Makes the bills of a run (no permission check: callers check). */
create or replace function private.billing_run_issue(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
  c record;
  v_inv uuid;
  v_count int := 0;
  v_total numeric := 0;
  v_line jsonb;
  v_disc_pct numeric := private.setting_numeric('billing.early_discount_pct', 0);
  v_disc_days int := private.setting_int('billing.early_discount_days', 30);
begin
  select * into v from public.billing_runs where id = p_id for update;
  if v.status not in ('approved', 'generating') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.billing_runs set status = 'generating', issue_date = current_date where id = p_id;

  for c in select * from private.billing_run_candidates(v) where exception is null loop
    insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, run_id, assessment_id, issue_date, due_date,
                                 discount_until, early_discount_pct, total, created_by)
    values (private.invoice_number(v.year), c.parcel_id, c.district_id, v.fee_type_id, v.period, v.id, c.assessment_id,
            current_date, v.due_date, case when v_disc_pct > 0 then current_date + v_disc_days end, v_disc_pct, c.amount, auth.uid())
    on conflict (parcel_id, fee_type_id, period) do nothing
    returning id into v_inv;
    if v_inv is not null then
      for v_line in select * from jsonb_array_elements(c.lines) loop
        if (v_line ->> 'amount')::numeric <> 0 then
          insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
          values (v_inv, (v_line ->> 'kind')::public.invoice_line_kind, v_line ->> 'description', (v_line ->> 'amount')::numeric, auth.uid());
        end if;
      end loop;
      perform private.parcel_event(c.parcel_id, 'invoiced', null, jsonb_build_object('invoice_id', v_inv, 'period', v.period, 'total', c.amount));
      insert into public.jobs (kind, payload, created_by)
      values ('sms.invoice_issued', jsonb_build_object('invoice_id', v_inv), auth.uid());
      v_count := v_count + 1;
      v_total := v_total + c.amount;
    end if;
    v_inv := null;
  end loop;

  update public.billing_runs
     set status = 'issued', issued_at = now(),
         invoice_count = (select count(*) from public.invoices where run_id = p_id),
         total = (select coalesce(sum(total), 0) from public.invoices where run_id = p_id)
   where id = p_id;
  return jsonb_build_object('created', v_count, 'total', v_total);
end;
$$;

create or replace function public.billing_run_generate(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.approve');
  v := private.billing_run_scope(p_id);
  if v.status not in ('approved', 'generating') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  return private.billing_run_issue(p_id);
end;
$$;

/** Issue a run's bills now, without the finance approval step (whoever may make runs). */
create or replace function public.billing_run_issue_now(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_runs;
begin
  perform private.assert_permission('billing.create');
  v := private.billing_run_scope(p_id);
  if v.status not in ('draft', 'submitted', 'approved') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.billing_runs set preview = private.billing_run_preview(v) where id = p_id returning * into v;
  if (v.preview ->> 'count')::int = 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_to_bill');
  end if;
  update public.billing_runs
     set status = 'approved', submitted_at = coalesce(submitted_at, now()), approved_by = auth.uid(), approved_at = now()
   where id = p_id;
  return private.billing_run_issue(p_id);
end;
$$;

/** 1 January: this year's property tax run for each district with registered land, made and issued. */
create or replace function private.billing_auto_year()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_fee uuid := (select id from public.fee_types where code = 'property_tax' and active limit 1);
  d record;
  v public.billing_runs;
begin
  if v_fee is null then
    return;
  end if;
  for d in select distinct p.district_id from public.parcels p where p.status = 'registered' and p.deleted_at is null loop
    continue when exists (select 1 from public.billing_runs r where r.fee_type_id = v_fee and r.period = v_year::text
                            and d.district_id = any (r.district_ids) and r.status <> 'cancelled');
    insert into public.billing_runs (number, year, period, fee_type_id, district_ids, due_date, note, automatic)
    values ('BR-' || v_year || '-' || lpad(private.next_serial('BR-' || v_year)::text, 3, '0'), v_year, v_year::text, v_fee,
            array[d.district_id], current_date + private.setting_int('billing.due_days', 60), 'Made automatically on 1 January', true)
    returning * into v;
    update public.billing_runs set preview = private.billing_run_preview(v) where id = v.id returning * into v;
    if (v.preview ->> 'count')::int > 0 then
      update public.billing_runs set status = 'approved', submitted_at = now(), approved_at = now() where id = v.id;
      perform private.billing_run_issue(v.id);
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('billing-auto-year', '0 3 1 1 *', 'select private.billing_auto_year()');
  end if;
end;
$$;

/** A run's bills in batches: one row per neighbourhood with its count and total (bills made, or the preview). */
create or replace function public.billing_run_batches(p_id uuid)
returns table (neighbourhood_id uuid, neighbourhood_code text, neighbourhood_so text, neighbourhood_en text,
               section_so text, section_en text, district_so text, district_en text,
               bills int, total numeric, skipped int)
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
         (count(*) filter (where it.exception is not null))::int
  from items it
  join public.parcels p on p.id = it.parcel_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.sectors sc on sc.id = n.sector_id
  left join public.sections sec on sec.id = sc.section_id
  left join public.districts d on d.id = p.district_id
  group by n.id, n.code, n.name_so, n.name_en, sec.name_so, sec.name_en, d.name_so, d.name_en
  order by d.name_en, sec.name_en, n.code;
end;
$$;

/** The bills of one batch (a neighbourhood; null = land without one). */
create or replace function public.billing_run_batch_bills(p_id uuid, p_neighbourhood uuid)
returns table (parcel_id uuid, pun text, house_no text, owner text, amount numeric, exception text,
               invoice_id uuid, invoice_number text, invoice_status text)
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
    select i.parcel_id, i.total as amount, null::text as exception, i.id as inv, i.number as inv_no, i.status::text as inv_status
      from public.invoices i where v.status = 'issued' and i.run_id = p_id
    union all
    select c.parcel_id, c.amount, c.exception, null, null, null from private.billing_run_candidates(v) c where v.status <> 'issued'
  )
  select p.id, p.pun, p.house_no,
         (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
           where po.parcel_id = p.id and po.valid_to is null),
         it.amount, it.exception, it.inv, it.inv_no, it.inv_status
  from items it join public.parcels p on p.id = it.parcel_id
  where p.neighbourhood_id is not distinct from p_neighbourhood
  order by it.exception nulls first, p.pun;
end;
$$;
