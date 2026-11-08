-- The land page's "Valuation and tax" works the tax out the same way as the bill (owner decision 2026-11-08):
-- the property type's rate × the taxable area (width × length; a flat's own m²), plus the service charge.
-- It showed a neighbourhood or default rate (180 m² × $0.25 = $45) while the bill said 180 m² × $0.30 = $54 + $12.
-- Land without a property type keeps the neighbourhood rate, or the default rate from settings.

create or replace function private.compute_assessment(p_parcel uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_on date := make_date(p_year, 1, 1);
  v_rate public.neighbourhood_rates;
  v_grade public.property_grades;
  v_area numeric;
  v_rate_m2 numeric;
  v_source text;
  v_land numeric;
  v_buildings numeric;
  v_lines jsonb;
  v_ex record;
  v_ex_pct numeric := 0;
  v_service numeric;
  v_subtotal numeric;
  v_ex_amount numeric;
begin
  select * into v_p from public.parcels where id = p_parcel;
  v_rate := private.rate_for(v_p.neighbourhood_id, v_p.land_use, v_p.developed, v_on);
  if v_p.property_type is not null then
    select * into v_grade from public.property_grades where code = v_p.property_type;
  end if;

  if coalesce(v_grade.amount, 0) > 0 then
    -- As the bill: a flat by its own m², other land by width × length (else its area).
    v_area := case when v_p.parent_id is not null then coalesce(v_p.area_m2, 0)
                   else coalesce(nullif(round(v_p.plot_width_m * v_p.plot_length_m, 2), 0), v_p.area_m2, 0) end;
    v_rate_m2 := v_grade.amount;
    v_source := 'property_type';
  else
    v_area := coalesce(v_p.area_m2, 0);
    v_rate_m2 := coalesce(v_rate.rate_m2, private.setting_numeric('valuation.default_rate_m2', 0.25));
    v_source := case when v_rate.id is null then 'default' else 'neighbourhood' end;
  end if;
  v_land := round(v_rate_m2 * v_area, 2);

  select coalesce(sum(round(g.amount * b.units, 2)), 0),
         coalesce(jsonb_agg(jsonb_build_object('building_id', b.id, 'grade', g.code, 'grade_so', g.name_so, 'grade_en', g.name_en,
                                               'units', b.units, 'amount', g.amount, 'line', round(g.amount * b.units, 2))
                            order by g.sort), '[]'::jsonb)
    into v_buildings, v_lines
  from public.buildings b join public.property_grades g on g.id = b.grade_id
  where b.parcel_id = p_parcel and b.deleted_at is null;

  select e.id, e.kind, e.pct into v_ex from public.exemptions e
  where e.parcel_id = p_parcel and e.status = 'approved'
    and e.valid_from <= make_date(p_year, 12, 31) and (e.valid_to is null or e.valid_to >= v_on)
  order by e.pct desc limit 1;
  v_ex_pct := coalesce(v_ex.pct, 0);

  -- The service charge as billed: the neighbourhood's own, else the Service charge fee.
  v_service := coalesce(nullif(v_rate.service_charge, 0),
                        (select round(f.amount, 2) from public.fee_types f where f.code = 'service_charge' and f.active), 0);
  v_subtotal := v_land + v_buildings;
  v_ex_amount := round(v_subtotal * v_ex_pct / 100, 2);

  return jsonb_build_object(
    'parcel_id', p_parcel, 'year', p_year, 'land_use', v_p.land_use, 'developed', v_p.developed,
    'area_m2', v_area, 'rate_m2', v_rate_m2, 'rate_id', v_rate.id,
    'rate_source', v_source,
    'property_type', v_grade.code, 'property_type_so', v_grade.name_so, 'property_type_en', v_grade.name_en,
    'rate_valid_from', v_rate.valid_from,
    'land_amount', v_land, 'buildings', v_lines, 'buildings_amount', v_buildings,
    'exemption_id', v_ex.id, 'exemption_kind', v_ex.kind, 'exemption_pct', v_ex_pct, 'exemption_amount', v_ex_amount,
    'service_charge', v_service,
    'total', greatest(v_subtotal - v_ex_amount + v_service, 0));
end;
$$;
