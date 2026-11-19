-- Apartments (owner's rule, 2026-11-17): the rest of the plot is billed to the manager at the "Empty Land" price
-- (house type code "warehouse", named Empty Land in Valuation), not the separate open-ground price. Flats follow the
-- prices in Valuation, a neighbourhood's own prices included: ground floor × Apartment, upper floors × Upper Floors.

insert into public.property_grades (code, name_so, name_en, amount, active, sort)
values ('warehouse', 'Dhul bannaan', 'Empty Land', 0.10, true, 95)
on conflict (code) do nothing;

do $$
declare
  f text;
  d text;
begin
  foreach f in array array['private.billing_run_candidates_all(billing_runs)', 'public.neighbourhood_rebill(uuid,uuid[])', 'private.building_ground_bill(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('''open_ground''' in d) = 0 then
      raise exception '%: open_ground not found', f;
    end if;
    d := replace(d, '''open_ground''', '''warehouse''');
    d := replace(d, '''Open ground: ''', '''Empty land: ''');
    execute d;
  end loop;
  -- A flat's bill: the house type's price in its neighbourhood (Valuation → Rates), else the normal price.
  d := pg_get_functiondef('private.unit_bill_adjust(uuid)'::regprocedure);
  if position('v_want := round(v.area_m2 * v_grade.amount, 2);' in d) = 0 then
    raise exception 'unit_bill_adjust: anchor not found';
  end if;
  d := replace(d, 'v_want := round(v.area_m2 * v_grade.amount, 2);',
               'v_grade.amount := coalesce(private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount), v_grade.amount);
  v_want := round(v.area_m2 * v_grade.amount, 2);');
  execute d;
end $$;

-- Buildings already made: their rest-of-plot bills follow the Empty Land price (bills already paid are not lowered).
do $$
declare
  b uuid;
begin
  for b in select id from public.parcels where layout = 'flats' and deleted_at is null and building_state is distinct from 'demolished' loop
    perform private.building_ground_bill(b);
  end loop;
end $$;
