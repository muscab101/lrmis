-- Valuation → Rates, new: a price per m² for each house type (property grade) in a chosen neighbourhood. Bills for land
-- in that neighbourhood use it; where none is set, the house type's normal price stays. This replaces the old rates by
-- land use (there were none in use), which no longer show.

create table public.neighbourhood_grade_prices (
  neighbourhood_id  uuid not null references public.neighbourhoods (id) on delete cascade,
  grade_id          uuid not null references public.property_grades (id) on delete cascade,
  amount            numeric(12, 4) not null check (amount >= 0 and amount <= 100000),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,
  primary key (neighbourhood_id, grade_id)
);
create index neighbourhood_grade_prices_grade_idx on public.neighbourhood_grade_prices (grade_id);
create index neighbourhood_grade_prices_updated_by_idx on public.neighbourhood_grade_prices (updated_by);
create trigger audit after insert or update or delete on public.neighbourhood_grade_prices for each row execute function private.audit_row();

alter table public.neighbourhood_grade_prices enable row level security;
revoke all on public.neighbourhood_grade_prices from public, anon;
revoke insert, update, delete on public.neighbourhood_grade_prices from authenticated;
grant select on public.neighbourhood_grade_prices to authenticated;
create policy neighbourhood_grade_prices_select on public.neighbourhood_grade_prices for select to authenticated using (true);

/** The price per m² of a house type in a neighbourhood: its own price there, or else the type's normal price. */
create or replace function private.grade_price_here(p_grade uuid, p_neighbourhood uuid, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select x.amount from public.neighbourhood_grade_prices x where x.grade_id = p_grade and x.neighbourhood_id = p_neighbourhood), p_default);
$$;
revoke all on function private.grade_price_here(uuid, uuid, numeric) from public, anon, authenticated;

/**
 * Set a neighbourhood's prices: [{grade_id, amount}], amount empty = use the type's normal price there.
 * Returns how many prices the neighbourhood now has of its own.
 */
create function public.neighbourhood_grade_prices_save(p_neighbourhood uuid, p_prices jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_amount numeric;
begin
  perform private.assert_permission('valuation.update');
  if not exists (select 1 from public.neighbourhoods n join public.sectors s on s.id = n.sector_id join public.sections c on c.id = s.section_id
                  where n.id = p_neighbourhood and public.can_access_district(c.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  if jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) > 200 then
    perform private.raise_app_error('VALIDATION', 'selection');
  end if;
  for r in select value from jsonb_array_elements(p_prices) loop
    v_amount := nullif(r ->> 'amount', '')::numeric;
    if v_amount is null then
      delete from public.neighbourhood_grade_prices where neighbourhood_id = p_neighbourhood and grade_id = (r ->> 'grade_id')::uuid;
    elsif v_amount < 0 or v_amount > 100000 then
      perform private.raise_app_error('VALIDATION', 'amount');
    elsif not exists (select 1 from public.property_grades where id = (r ->> 'grade_id')::uuid) then
      perform private.raise_app_error('NOT_FOUND', 'grade');
    else
      insert into public.neighbourhood_grade_prices (neighbourhood_id, grade_id, amount, updated_by)
      values (p_neighbourhood, (r ->> 'grade_id')::uuid, round(v_amount, 4), auth.uid())
      on conflict (neighbourhood_id, grade_id) do update
        set amount = excluded.amount, updated_at = now(), updated_by = excluded.updated_by
        where public.neighbourhood_grade_prices.amount is distinct from excluded.amount;
    end if;
  end loop;
  return (select count(*) from public.neighbourhood_grade_prices where neighbourhood_id = p_neighbourhood);
end;
$$;
revoke all on function public.neighbourhood_grade_prices_save(uuid, jsonb) from public, anon;
grant execute on function public.neighbourhood_grade_prices_save(uuid, jsonb) to authenticated;

-- Every place that prices land by its house type now asks for the neighbourhood's price first.
do $do$
declare
  r record;
  v text;
  v_new text;
begin
  for r in
    select * from (values
      ('private.parcel_bill(uuid)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.parcel_rebill(uuid)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.parcel_register_one(uuid,public.land_use,text)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.unit_bill_adjust(uuid)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.certificate_year_facts(uuid,integer)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.application_expected_fees(uuid)', 'select * into v_grade from public.property_grades where code = v.property_type;',
       E'select * into v_grade from public.property_grades where code = v.property_type;\n  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);'),
      ('private.compute_assessment(uuid,integer)', 'select * into v_grade from public.property_grades where code = v_p.property_type;',
       E'select * into v_grade from public.property_grades where code = v_p.property_type;\n    v_grade.amount := private.grade_price_here(v_grade.id, v_p.neighbourhood_id, v_grade.amount);'),
      ('public.invoice_missing()', 'coalesce(g.amount, 0) as price',
       'coalesce(private.grade_price_here(g.id, p.neighbourhood_id, g.amount), 0) as price'),
      ('private.building_ground_bill(uuid)', 'v_rate numeric := (select amount from public.property_grades where code = ''open_ground'' and active);',
       'v_rate numeric := (select private.grade_price_here(g.id, (select gp.neighbourhood_id from public.parcels gp where gp.id = p_building), g.amount) from public.property_grades g where g.code = ''open_ground'' and g.active);'),
      ('private.billing_run_candidates_all(public.billing_runs)', '(select og.amount from public.property_grades og where og.code = ''open_ground'' and og.active)',
       '(select private.grade_price_here(og.id, p.neighbourhood_id, og.amount) from public.property_grades og where og.code = ''open_ground'' and og.active)'),
      ('private.billing_run_candidates_all(public.billing_runs)', 'else g.amount end as price',
       'else private.grade_price_here(g.id, p.neighbourhood_id, g.amount) end as price')
    ) as t(fn, find, put)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    v_new := replace(v, r.find, r.put);
    if v_new = v then
      raise exception '%: text not found', r.fn;
    end if;
    execute v_new;
  end loop;
end;
$do$;
