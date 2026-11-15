-- Apartment buildings: the manager is a real person (like an owner), on the building's people list with the role
-- "manager". The building's extra areas (parking, playgrounds, …) each have their size and a price per m² set by the
-- admin, and are charged to the building's bill on top of the open ground. The manager pays that bill.

alter type public.application_party_role add value if not exists 'manager';

alter table public.parcels add column if not exists manager_party_id uuid references public.parties(id);
create index if not exists parcels_manager_party_idx on public.parcels (manager_party_id) where manager_party_id is not null;

create table if not exists public.building_extra_areas (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels(id),
  name text not null check (length(trim(name)) between 2 and 60),
  area_m2 numeric not null check (area_m2 > 0 and area_m2 <= 1000000),
  price_m2 numeric not null check (price_m2 >= 0 and price_m2 <= 100000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists building_extra_areas_parcel_idx on public.building_extra_areas (parcel_id);
alter table public.building_extra_areas enable row level security;
drop policy if exists building_extra_areas_read on public.building_extra_areas;
create policy building_extra_areas_read on public.building_extra_areas for select to authenticated
  using (exists (select 1 from public.parcels p where p.id = building_extra_areas.parcel_id));
grant select on public.building_extra_areas to authenticated;

/** The building's ground bill: open ground (plot − footprint) at the open-ground price, plus each extra area. */
create or replace function private.building_ground_bill(p_building uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_rate numeric := (select private.grade_price_here(g.id, (select gp.neighbourhood_id from public.parcels gp where gp.id = p_building), g.amount)
                       from public.property_grades g where g.code = 'open_ground' and g.active);
  v_plot numeric;
  v_open numeric := 0;
  v_ground numeric := 0;
  v_ground_line text;
  v_extra numeric;
  v_extra_line text;
  v_want numeric;
  v_line text;
  v_inv public.invoices;
begin
  select * into b from public.parcels where id = p_building;
  if b.id is null or b.layout <> 'flats' or b.deleted_at is not null then
    return;
  end if;
  v_plot := round(b.plot_width_m * b.plot_length_m, 2);
  if b.footprint_m2 is not null then
    v_open := round(coalesce(v_plot, 0) - b.footprint_m2, 2);
  end if;
  if v_open > 0 and coalesce(v_rate, 0) > 0 then
    v_ground := round(v_open * v_rate, 2);
    v_ground_line := 'Open ground: ' || trim(to_char(v_plot, 'FM9999990.##')) || ' m² plot − ' || trim(to_char(b.footprint_m2, 'FM9999990.##'))
      || ' m² footprint = ' || trim(to_char(v_open, 'FM9999990.##')) || ' m² × ' || trim(to_char(v_rate, 'FM9999990.00')) || ' USD per m²';
  end if;
  -- Extra areas (parking, playgrounds, …): each m² × its own price, on top of the open ground.
  select coalesce(round(sum(e.area_m2 * e.price_m2), 2), 0),
         string_agg(e.name || ' ' || trim(to_char(e.area_m2, 'FM9999990.##')) || ' m² × ' || trim(to_char(e.price_m2, 'FM9999990.00')) || ' USD', '; ' order by e.created_at)
    into v_extra, v_extra_line
    from public.building_extra_areas e where e.parcel_id = b.id;
  v_line := concat_ws('; ', v_ground_line, case when v_extra_line is not null then 'Extra areas: ' || v_extra_line end);
  v_want := v_ground + v_extra;
  select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = b.id and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1;
  if v_inv.id is null then
    if v_want > 0 then
      perform private.parcel_raise_invoice(b.id, 'property_bill', v_want, v_line, 'tax');
    end if;
  elsif v_inv.total <> v_want and v_want >= v_inv.paid + v_inv.credited then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv.id, 'tax', 'Re-bill: ' || coalesce(nullif(v_line, ''), 'nothing to charge') || ' (was ' || v_inv.total || ' USD)', v_want - v_inv.total, auth.uid());
    update public.invoices set total = v_want where id = v_inv.id;
    perform private.invoice_refresh_status(v_inv.id);
  end if;
end;
$$;

/** Set (or change) an apartment building's manager: a person, who then holds the building with the role "manager". */
create or replace function public.building_manager_set(p_building uuid, p_party uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  m public.parties;
begin
  if not (public.has_permission('parcels.update') or public.has_permission('valuation.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.update');
  end if;
  perform private.assert_parcel_scope(p_building);
  select * into b from public.parcels where id = p_building and deleted_at is null for update;
  if b.id is null or b.layout <> 'flats' then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  select * into m from public.parties where id = p_party and deleted_at is null;
  if m.id is null then
    perform private.raise_app_error('NOT_FOUND', 'party');
  end if;
  -- The previous manager stops; the new one holds the building as its manager.
  update public.parcel_owners set valid_to = current_date
   where parcel_id = b.id and role = 'manager' and valid_to is null and party_id <> m.id;
  if not exists (select 1 from public.parcel_owners where parcel_id = b.id and party_id = m.id and role = 'manager' and valid_to is null) then
    insert into public.parcel_owners (parcel_id, party_id, role) values (b.id, m.id, 'manager');
  end if;
  update public.parcels set manager_party_id = m.id, manager_name = m.full_name, manager_phone = m.phone, updated_at = now() where id = b.id;
  perform private.parcel_event(b.id, 'manager_set', m.full_name, jsonb_build_object('party_id', m.id));
  return jsonb_build_object('party_id', m.id, 'name', m.full_name);
end;
$$;
revoke all on function public.building_manager_set(uuid, uuid) from public, anon;
grant execute on function public.building_manager_set(uuid, uuid) to authenticated;

/** Add or change one extra area of an apartment building (name, m², price per m²); the building's bill follows. */
create or replace function public.building_area_save(p_id uuid, p_building uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.parcels;
  v_name text := trim(coalesce(p ->> 'name', ''));
  v_area numeric;
  v_price numeric;
  v_id uuid := p_id;
begin
  if not (public.has_permission('parcels.update') or public.has_permission('valuation.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.update');
  end if;
  perform private.assert_parcel_scope(p_building);
  select * into b from public.parcels where id = p_building and deleted_at is null for update;
  if b.id is null or b.layout <> 'flats' then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if b.building_state = 'demolished' then
    perform private.raise_app_error('CONFLICT', 'parcel_demolished');
  end if;
  begin
    v_area := (p ->> 'area_m2')::numeric;
    v_price := (p ->> 'price_m2')::numeric;
  exception when others then
    perform private.raise_app_error('VALIDATION', 'area');
  end;
  if length(v_name) < 2 or length(v_name) > 60 then
    perform private.raise_app_error('VALIDATION', 'name');
  end if;
  if v_area is null or v_area <= 0 or v_area > 1000000 then
    perform private.raise_app_error('VALIDATION', 'area');
  end if;
  if v_price is null or v_price < 0 or v_price > 100000 then
    perform private.raise_app_error('VALIDATION', 'price');
  end if;
  if v_id is null then
    insert into public.building_extra_areas (parcel_id, name, area_m2, price_m2) values (b.id, v_name, v_area, v_price) returning id into v_id;
  else
    update public.building_extra_areas set name = v_name, area_m2 = v_area, price_m2 = v_price, updated_at = now()
     where id = v_id and parcel_id = b.id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'area');
    end if;
  end if;
  perform private.building_ground_bill(b.id);
  perform private.parcel_event(b.id, 'extra_area_saved', v_name, jsonb_build_object('area_m2', v_area, 'price_m2', v_price));
  return v_id;
end;
$$;
revoke all on function public.building_area_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.building_area_save(uuid, uuid, jsonb) to authenticated;

create or replace function public.building_area_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.building_extra_areas;
begin
  if not (public.has_permission('parcels.update') or public.has_permission('valuation.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.update');
  end if;
  select * into a from public.building_extra_areas where id = p_id;
  if a.id is null then
    perform private.raise_app_error('NOT_FOUND', 'area');
  end if;
  perform private.assert_parcel_scope(a.parcel_id);
  delete from public.building_extra_areas where id = a.id;
  perform private.building_ground_bill(a.parcel_id);
  perform private.parcel_event(a.parcel_id, 'extra_area_removed', a.name, '{}'::jsonb);
end;
$$;
revoke all on function public.building_area_remove(uuid) from public, anon;
grant execute on function public.building_area_remove(uuid) to authenticated;

-- Yearly bills (billing runs and the anniversary bills): a building's extra areas are charged on top of its open ground.
do $$
declare
  d text := pg_get_functiondef('private.billing_run_candidates_all(billing_runs)'::regprocedure);
  a1 text := 'else private.grade_price_here(g.id, p.neighbourhood_id, g.amount) end as price';
  b1 text := 'else private.grade_price_here(g.id, p.neighbourhood_id, g.amount) end as price,
           case when p.layout = ''flats'' then coalesce((select round(sum(e.area_m2 * e.price_m2), 2) from public.building_extra_areas e where e.parcel_id = p.id), 0) else 0 end as extras';
  a2 text := 'case when s.size_m2 > 0 and s.price is not null then round(s.size_m2 * s.price, 2) end as auto_amount';
  b2 text := 'case when s.size_m2 > 0 and s.price is not null then round(s.size_m2 * s.price, 2) + s.extras when s.extras > 0 then s.extras end as auto_amount';
  a3 text := '''amount'', x.auto_amount))';
  b3 text := '''amount'', x.auto_amount - x.extras))
                || case when x.extras > 0 then jsonb_build_array(jsonb_build_object(''kind'', ''tax'',
                     ''description'', ''Extra areas '' || p_run.period || '' (parking, playgrounds…)'', ''amount'', x.extras)) else ''[]''::jsonb end';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'billing_run_candidates_all: anchors not found';
  end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;
