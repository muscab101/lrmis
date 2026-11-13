-- Valuation → Rates: after changing a neighbourhood's prices, its unpaid property bills can follow. Each open bill
-- (not paid in full) of land there with a changed house type is set to size × the new price; a bill is never set below
-- what was already paid on it (that one is left and counted). Flats use their taxable area; a flats building's open
-- ground uses the open-ground price. Every change is a line on the bill and an event on the land.

create or replace function public.neighbourhood_rebill(p_neighbourhood uuid, p_grades uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_price numeric;
  v_area numeric;
  v_want numeric;
  v_inv public.invoices;
  v_changed int := 0;
  v_same int := 0;
  v_paid int := 0;
  v_codes text[];
begin
  perform private.assert_permission('valuation.update');
  if not exists (select 1 from public.neighbourhoods n join public.sectors s on s.id = n.sector_id join public.sections c on c.id = s.section_id
                  where n.id = p_neighbourhood and public.can_access_district(c.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  select coalesce(array_agg(code), '{}') into v_codes from public.property_grades where id = any (coalesce(p_grades, '{}'));

  for r in
    select p.id, p.parent_id, p.layout, p.property_type, p.plot_width_m, p.plot_length_m, p.area_m2, p.footprint_m2, p.unit_no, g.id as grade_id, g.amount, g.name_en
      from public.parcels p
      join public.property_grades g on g.code = case when p.layout = 'flats' then 'open_ground' else p.property_type end
     where p.neighbourhood_id = p_neighbourhood and p.deleted_at is null and p.building_state = 'standing'
       and g.code = any (v_codes)
       and (p.layout = 'house' or p.parent_id is not null or p.layout = 'flats')
  loop
    v_price := private.grade_price_here(r.grade_id, p_neighbourhood, r.amount);
    v_area := case
      when r.layout = 'flats' and r.parent_id is null then greatest(coalesce(r.area_m2, 0) - coalesce(r.footprint_m2, r.area_m2, 0), 0)
      when r.parent_id is not null then r.area_m2
      else coalesce(nullif(round(r.plot_width_m * r.plot_length_m, 2), 0), r.area_m2) end;
    if coalesce(v_price, 0) <= 0 or coalesce(v_area, 0) <= 0 then
      continue;
    end if;
    v_want := round(v_area * v_price, 2);
    select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
     where i.parcel_id = r.id and f.code = 'property_bill' and i.status in ('issued', 'partially_paid')
     order by i.issue_date desc, i.created_at desc limit 1;
    if v_inv.id is null then
      continue;
    elsif v_inv.total = v_want then
      v_same := v_same + 1;
    elsif v_want < v_inv.paid + v_inv.credited then
      v_paid := v_paid + 1;
    else
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (v_inv.id, 'tax', 'New price in this neighbourhood: ' || r.name_en || ': ' || trim(to_char(v_area, 'FM9999990.##')) || ' m² × '
                || trim(to_char(v_price, 'FM9999990.00##')) || ' USD per m² (was ' || v_inv.total || ' USD)', v_want - v_inv.total, auth.uid());
      update public.invoices set total = v_want where id = v_inv.id;
      perform private.invoice_refresh_status(v_inv.id);
      perform private.parcel_event(r.id, 'rebilled', 'Neighbourhood price changed', jsonb_build_object('invoice', v_inv.number, 'from', v_inv.total, 'to', v_want));
      v_changed := v_changed + 1;
    end if;
  end loop;
  return jsonb_build_object('changed', v_changed, 'same', v_same, 'paid_more', v_paid);
end;
$$;
revoke all on function public.neighbourhood_rebill(uuid, uuid[]) from public, anon;
grant execute on function public.neighbourhood_rebill(uuid, uuid[]) to authenticated;
