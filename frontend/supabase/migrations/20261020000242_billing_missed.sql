-- Billing → Billing runs: "Missed yearly bills". Land whose tax anniversary has come but that has no yearly bill since
-- (the automatic daily billing skipped it, for example an anniversary before automatic billing started, or a day the job
-- did not run). Staff check the list and make billing runs for the ones they choose; the runs then go through the usual
-- approval and issue.

/** Registered, standing land whose last anniversary has come without a yearly bill since. */
create or replace function public.billing_missed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce((select (value #>> '{}')::date from public.settings where key = 'billing.anniversary_from'), current_date);
  v jsonb;
begin
  perform private.assert_permission('billing.view');
  select coalesce(jsonb_agg(jsonb_build_object(
           'parcel_id', p.id, 'pun', p.pun, 'house_no', p.house_no,
           'neighbourhood_code', (select n.code from public.neighbourhoods n where n.id = p.neighbourhood_id),
           'district_id', p.district_id,
           'district_so', d.name_so, 'district_en', d.name_en,
           'anniversary', private.last_anniversary(p.tax_anniversary),
           'year', extract(year from private.last_anniversary(p.tax_anniversary))::int,
           'before_automatic', private.last_anniversary(p.tax_anniversary) < v_from,
           'owners', (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                       where po.parcel_id = p.id and po.valid_to is null and po.role <> 'manager'))
         order by private.last_anniversary(p.tax_anniversary), p.pun), '[]'::jsonb)
    into v
    from public.parcels p
    join public.districts d on d.id = p.district_id
   where p.deleted_at is null and p.status in ('registered', 'disputed') and p.building_state = 'standing'
     and p.layout in ('house', 'flats') and p.tax_anniversary is not null
     and private.last_anniversary(p.tax_anniversary) is not null
     and public.can_access_district(p.district_id)
     and not exists (select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
                      where i.parcel_id = p.id and f.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
                        and i.issue_date >= private.last_anniversary(p.tax_anniversary));
  return v;
end;
$$;
revoke all on function public.billing_missed() from public, anon;
grant execute on function public.billing_missed() to authenticated;

/** Make billing runs (one per district and year) for the chosen missed land; they wait for approval like any run. */
create or replace function public.billing_missed_create(p_parcels uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee uuid := (select id from public.fee_types where code = 'property_tax' and active limit 1);
  g record;
  v public.billing_runs;
  v_out jsonb := '[]'::jsonb;
begin
  perform private.assert_permission('billing.create');
  if coalesce(cardinality(p_parcels), 0) = 0 or cardinality(p_parcels) > 5000 then
    perform private.raise_app_error('VALIDATION', 'parcels');
  end if;
  if v_fee is null then
    perform private.raise_app_error('VALIDATION', 'fee_type');
  end if;
  for g in
    select (x ->> 'district_id')::uuid as district_id, (x ->> 'year')::int as yr, array_agg((x ->> 'parcel_id')::uuid) as ids
      from jsonb_array_elements(public.billing_missed()) x
     where (x ->> 'parcel_id')::uuid = any (p_parcels)
     group by 1, 2
     order by 2, 1
  loop
    insert into public.billing_runs (number, year, period, fee_type_id, district_ids, parcel_ids, due_date, note, created_by)
    values ('BR-' || g.yr || '-' || lpad(private.next_serial('BR-' || g.yr)::text, 3, '0'), g.yr, g.yr::text, v_fee,
            array[g.district_id], g.ids, current_date + private.setting_int('billing.due_days', 60),
            'Missed yearly bills (' || cardinality(g.ids) || ')', auth.uid())
    returning * into v;
    update public.billing_runs set preview = private.billing_run_preview(v) where id = v.id returning * into v;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v.id, 'number', v.number, 'land', cardinality(g.ids),
                                                           'bills', coalesce((v.preview ->> 'count')::int, 0)));
  end loop;
  if jsonb_array_length(v_out) = 0 then
    perform private.raise_app_error('NOT_FOUND', 'missed');
  end if;
  return v_out;
end;
$$;
revoke all on function public.billing_missed_create(uuid[]) from public, anon;
grant execute on function public.billing_missed_create(uuid[]) to authenticated;
