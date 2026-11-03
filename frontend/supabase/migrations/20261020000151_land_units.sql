-- Flats buildings and shared compounds (owner decision 2026-11-03). A land can be a normal house, a building of flats, or
-- a compound of houses sharing a play place and empty land. The land keeps one PUN and holds no bills or owners itself.
-- Each flat or house is a land record under it (parent_id), so it has its own PUN (KRWJXL0113-01), owner, bill, payments,
-- certificate and transfers exactly as any land does. On a compound the shared m² are split among the houses.

alter table public.parcels
  add column layout text not null default 'house' check (layout in ('house', 'flats', 'compound')),
  add column parent_id uuid references public.parcels (id),
  add column unit_no text,
  add column unit_floor int,
  add column own_m2 numeric(12, 2),
  add column shared_m2 numeric(12, 2),
  add column floors int check (floors is null or floors between 1 and 100),
  add column shared_split text check (shared_split is null or shared_split in ('equal', 'by_size')),
  add constraint parcels_unit_shape check (
    (parent_id is null and unit_no is null) or (parent_id is not null and unit_no is not null and layout = 'house'));
create unique index parcels_unit_no_uidx on public.parcels (parent_id, unit_no) where deleted_at is null;
create index parcels_parent_idx on public.parcels (parent_id) where parent_id is not null;

create table public.parcel_shared_spaces (
  id         uuid primary key default gen_random_uuid(),
  parcel_id  uuid not null references public.parcels (id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 80),
  area_m2    numeric(12, 2) not null check (area_m2 >= 0)
);
alter table public.parcel_shared_spaces enable row level security;
create index parcel_shared_spaces_parcel_idx on public.parcel_shared_spaces (parcel_id);
-- Readable by whoever can read the land; written only by the function below.
create policy parcel_shared_spaces_read on public.parcel_shared_spaces for select to authenticated
  using (exists (select 1 from public.parcels p where p.id = parcel_id));

/** How the shared m² go to the houses. The last house takes the rounding, so the totals always add up to the land. */
create or replace function private.split_shared_m2(p_own numeric[], p_shared numeric, p_split text)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out numeric[] := '{}';
  v_sum numeric := 0;
  v_given numeric := 0;
  v_n int := cardinality(p_own);
  v_part numeric;
begin
  select sum(x) into v_sum from unnest(p_own) x;
  for i in 1 .. v_n loop
    if i = v_n then
      v_part := round(p_shared - v_given, 2);
    elsif p_split = 'by_size' then
      v_part := round(p_shared * p_own[i] / v_sum, 2);
    else
      v_part := round(p_shared / v_n, 2);
    end if;
    v_given := v_given + v_part;
    v_out := v_out || v_part;
  end loop;
  return v_out;
end;
$$;

/** Saves a flats building or a compound with all its units; each unit is billed, like any land saved in the field. */
create or replace function public.land_with_units_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_layout text := p ->> 'layout';
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_lon float8 := nullif(p ->> 'pin_lon', '')::float8;
  v_lat float8 := nullif(p ->> 'pin_lat', '')::float8;
  v_width numeric := nullif(p ->> 'plot_width_m', '')::numeric;
  v_length numeric := nullif(p ->> 'plot_length_m', '')::numeric;
  v_house text := nullif(trim(p ->> 'house_no'), '');
  v_type text := nullif(trim(p ->> 'property_type'), '');
  v_use public.land_use := coalesce(nullif(p ->> 'land_use', ''), 'residential')::public.land_use;
  v_floors int := nullif(p ->> 'floors', '')::int;
  v_split text := coalesce(nullif(p ->> 'shared_split', ''), 'equal');
  v_units jsonb := coalesce(p -> 'units', '[]'::jsonb);
  v_spaces jsonb := coalesce(p -> 'shared_spaces', '[]'::jsonb);
  v_land numeric;
  v_own numeric[];
  v_named numeric;
  v_shared numeric := 0;
  v_parts numeric[];
  v_pin extensions.geometry;
  v_geom extensions.geometry;
  v_nbhd uuid;
  v_half numeric;
  v_ids record;
  v_parent uuid;
  v_child uuid;
  v_party uuid;
  v_bills int := 0;
  v_no text;
  v_i int := 0;
  v_seen jsonb := '{}'::jsonb;
  v_key text;
  v_u jsonb;
  s jsonb;
begin
  if not (public.has_permission('surveys.create') or public.has_permission('applications.create')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.create');
  end if;
  if v_layout is null or v_layout not in ('flats', 'compound') then
    perform private.raise_app_error('VALIDATION', 'land_layout');
  end if;
  if v_district is null or not exists (select 1 from public.districts where id = v_district and deleted_at is null) then
    perform private.raise_app_error('VALIDATION', 'district');
  end if;
  if not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  if v_lon is null or v_lat is null then
    perform private.raise_app_error('VALIDATION', 'pin_required');
  end if;
  if v_width is null or v_length is null or v_width <= 0 or v_length <= 0 or v_width > 5000 or v_length > 5000 then
    perform private.raise_app_error('VALIDATION', 'plot_size');
  end if;
  v_land := round(v_width * v_length, 2);

  if jsonb_typeof(v_units) <> 'array' or jsonb_array_length(v_units) not between 2 and 200 then
    perform private.raise_app_error('VALIDATION', 'units_few');
  end if;
  if v_layout = 'flats' and (v_floors is null or v_floors not between 1 and 100) then
    perform private.raise_app_error('VALIDATION', 'unit_floors');
  end if;
  for v_u in select value from jsonb_array_elements(v_units) loop
    v_no := upper(trim(coalesce(v_u ->> 'unit_no', '')));
    if v_no !~ '^[A-Z0-9]{1,6}$' then
      perform private.raise_app_error('VALIDATION', 'unit_no');
    end if;
    if v_seen ? v_no then
      perform private.raise_app_error('VALIDATION', 'unit_no_twice');
    end if;
    v_seen := v_seen || jsonb_build_object(v_no, true);
    if coalesce(nullif(v_u ->> 'own_m2', '')::numeric, 0) <= 0 then
      perform private.raise_app_error('VALIDATION', 'unit_size');
    end if;
    if v_layout = 'flats' and coalesce(nullif(v_u ->> 'floor', '')::int, -1) not between 0 and v_floors then
      perform private.raise_app_error('VALIDATION', 'unit_floor');
    end if;
    if nullif(v_u ->> 'owner_id', '') is not null then
      if not exists (select 1 from public.parties pa where pa.id = (v_u ->> 'owner_id')::uuid and pa.deleted_at is null
                       and (pa.district_id is null or public.can_access_district(pa.district_id))) then
        perform private.raise_app_error('NOT_FOUND', 'owner');
      end if;
    elsif length(coalesce(trim(v_u ->> 'owner_name'), '')) < 3 then
      perform private.raise_app_error('VALIDATION', 'owner_name');
    end if;
  end loop;

  v_own := array(select (x ->> 'own_m2')::numeric from jsonb_array_elements(v_units) with ordinality t(x, n) order by n);
  if v_layout = 'compound' then
    if jsonb_typeof(v_spaces) <> 'array' then
      perform private.raise_app_error('VALIDATION', 'shared_space');
    end if;
    if v_split not in ('equal', 'by_size') then
      perform private.raise_app_error('VALIDATION', 'shared_split');
    end if;
    for s in select value from jsonb_array_elements(v_spaces) loop
      if length(coalesce(trim(s ->> 'name'), '')) not between 2 and 80 or coalesce(nullif(s ->> 'area_m2', '')::numeric, 0) <= 0 then
        perform private.raise_app_error('VALIDATION', 'shared_space');
      end if;
    end loop;
    select coalesce(sum((x ->> 'area_m2')::numeric), 0) into v_named from jsonb_array_elements(v_spaces) x;
    -- Everything on the land that isn't a house is shared: the spaces named, and the rest is empty land.
    v_shared := v_land - (select sum(x) from unnest(v_own) x);
    if v_shared < 0 or v_named > v_shared then
      perform private.raise_app_error('VALIDATION', 'compound_too_big');
    end if;
    v_parts := private.split_shared_m2(v_own, v_shared, v_split);
  end if;

  v_pin := extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326);
  v_nbhd := private.check_application_location(v_district, nullif(p ->> 'neighbourhood_id', '')::uuid, v_pin);
  if v_nbhd is null then
    perform private.raise_app_error('VALIDATION', 'neighbourhood');
  end if;
  if v_house is not null and exists (select 1 from private.house_numbers_in_use(v_nbhd, null) u where u.house_no = v_house) then
    perform private.raise_app_error('CONFLICT', 'house_no_taken');
  end if;

  v_half := greatest(least(sqrt(v_land) / 2, 100), 2);
  v_geom := extensions.st_envelope(extensions.st_buffer(v_pin::extensions.geography, v_half::float8)::extensions.geometry);
  select * into v_ids from private.next_pun(v_district, v_nbhd);
  insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, property_type, land_use, area_m2,
                              plot_width_m, plot_length_m, geom, geom_provisional, status, created_by,
                              layout, floors, shared_split, units)
  values (v_ids.pun, v_ids.account_no, v_district, v_nbhd, v_house, v_type, v_use, v_land, v_width, v_length, v_geom, true,
          'draft', auth.uid(), v_layout, v_floors, case when v_layout = 'compound' then v_split end, jsonb_array_length(v_units))
  returning id into v_parent;

  if v_layout = 'compound' then
    for s in select value from jsonb_array_elements(v_spaces) loop
      insert into public.parcel_shared_spaces (parcel_id, name, area_m2) values (v_parent, trim(s ->> 'name'), (s ->> 'area_m2')::numeric);
    end loop;
    if v_shared - v_named > 0 then
      insert into public.parcel_shared_spaces (parcel_id, name, area_m2) values (v_parent, 'Empty land', v_shared - v_named);
    end if;
  end if;

  v_seen := '{}'::jsonb;
  for v_u in select x from jsonb_array_elements(v_units) with ordinality t(x, n) order by n loop
    v_i := v_i + 1;
    v_no := upper(trim(v_u ->> 'unit_no'));
    -- One person with several units is one owner.
    if nullif(v_u ->> 'owner_id', '') is not null then
      v_party := (v_u ->> 'owner_id')::uuid;
    else
      v_key := lower(trim(v_u ->> 'owner_name')) || '|' || coalesce(trim(v_u ->> 'owner_phone'), '');
      if v_seen ? v_key then
        v_party := (v_seen ->> v_key)::uuid;
      else
        insert into public.parties (kind, full_name, phone, district_id, created_by)
        values ('person', trim(v_u ->> 'owner_name'), nullif(trim(v_u ->> 'owner_phone'), ''), v_district, auth.uid())
        returning id into v_party;
        v_seen := v_seen || jsonb_build_object(v_key, v_party);
      end if;
    end if;
    insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, flat_no, property_type, land_use, area_m2,
                                geom, geom_provisional, status, created_by, parent_id, unit_no, unit_floor, own_m2, shared_m2)
    values (v_ids.pun || '-' || v_no, v_ids.account_no || '-' || v_no, v_district, v_nbhd,
            case when v_house is not null then v_house || '-' || v_no end, v_no, v_type, v_use,
            v_own[v_i] + coalesce(v_parts[v_i], 0), v_geom, true, 'draft', auth.uid(), v_parent, v_no,
            case when v_layout = 'flats' then (v_u ->> 'floor')::int end, v_own[v_i], coalesce(v_parts[v_i], 0))
    returning id into v_child;
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_child, v_party, 'owner', 100);
    perform private.parcel_event(v_child, 'field_land_created', null, jsonb_build_object('land', v_ids.pun));
    v_bills := v_bills + private.parcel_bill(v_child);
  end loop;

  perform private.parcel_event(v_parent, 'field_land_created', nullif(trim(p ->> 'note'), ''),
    jsonb_build_object('pin', jsonb_build_array(v_lon, v_lat), 'accuracy_m', nullif(p ->> 'pin_accuracy_m', ''), 'units', jsonb_array_length(v_units)));
  return jsonb_build_object('parcel_id', v_parent, 'pun', v_ids.pun, 'bills', v_bills, 'units', jsonb_array_length(v_units));
end;
$$;
grant execute on function public.land_with_units_create(jsonb) to authenticated;

/** The tax bill and service charge. A unit is priced on its own m² (with its part of the shared m²); the land above it has no bills. */
create or replace function private.parcel_bill(p_parcel uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_service public.fee_types;
  v_area numeric;
  v_tax numeric := 0;
  v_line text;
  v_label text;
  v_n int := 0;
  f record;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.layout <> 'house' then
    return 0;
  end if;
  -- How the land is named on the service charge line before it has a PUN.
  select coalesce(v.pun, n.code || coalesce(' · ' || v.house_no, '')) into v_label from public.neighbourhoods n where n.id = v.neighbourhood_id;
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;
  if coalesce(v_grade.amount, 0) > 0 and v.parent_id is not null and coalesce(v.area_m2, 0) > 0 then
    v_tax := round(v.area_m2 * v_grade.amount, 2);
    v_line := v_grade.name_en || ': ' || v.unit_no || ' — ' || trim(to_char(v.area_m2, 'FM9999990.##'))
      || case when coalesce(v.shared_m2, 0) > 0
              then ' m² (' || trim(to_char(v.own_m2, 'FM9999990.##')) || ' + ' || trim(to_char(v.shared_m2, 'FM9999990.##')) || ' shared)'
              else ' m²' end
      || ' × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  elsif coalesce(v_grade.amount, 0) > 0 and v.plot_width_m is not null and v.plot_length_m is not null then
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_tax := round(v_area * v_grade.amount, 2);
    v_line := v_grade.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × '
      || trim(to_char(v.plot_length_m, 'FM999990.##')) || ' m = ' || trim(to_char(v_area, 'FM9999990.##'))
      || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  end if;
  select * into v_service from public.fee_types where code = 'service_charge' and active and coalesce(amount, 0) > 0;
  for f in
    select 'property_bill' code, v_tax amount, v_line line, 'tax'::public.invoice_line_kind kind where v_tax > 0
    union all
    select 'service_charge', round(v_service.amount, 2), coalesce(v_service.name_en, 'Service charge') || coalesce(' — ' || v_label, ''), 'service'
     where v_service.id is not null
  loop
    if not exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = v.id and ft.code = f.code and i.status <> 'cancelled') then
      perform private.parcel_raise_invoice(v.id, f.code, f.amount, f.line, f.kind);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Registering: a normal house as before. A building or compound registers with all its units; a unit never alone.
alter function public.parcel_register(uuid, public.land_use, text) set schema private;
alter function private.parcel_register(uuid, public.land_use, text) rename to parcel_register_one;
revoke all on function private.parcel_register_one(uuid, public.land_use, text) from public, anon, authenticated;

create function public.parcel_register(p_parcel uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  r record;
begin
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  if v.parent_id is not null then
    perform private.raise_app_error('CONFLICT', 'unit_follows_land');
  end if;
  if v.id is null or v.layout = 'house' then
    return private.parcel_register_one(p_parcel, p_land_use, p_note);
  end if;
  perform private.assert_permission('parcels.approve');
  if not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.status not in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  if v.site_check_status = 'not_found' then
    perform private.raise_app_error('CONFLICT', 'site_not_found');
  end if;
  update public.parcels set status = 'registered', registered_at = now(), registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v.id;
  perform private.parcel_event(v.id, 'registered', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Registered'),
    jsonb_build_object('pun', v.pun, 'account_no', v.account_no, 'provisional_boundary', v.geom_provisional));
  for r in select id, pun from public.parcels where parent_id = v.id and deleted_at is null and status in ('draft', 'surveyed', 'verified') loop
    update public.parcels set status = 'registered', registered_at = now(), registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
     where id = r.id;
    perform private.parcel_event(r.id, 'registered', 'Registered with ' || v.pun, jsonb_build_object('pun', r.pun));
    insert into public.jobs (kind, payload, created_by)
    values ('sms.parcel_registered', jsonb_build_object('parcel_id', r.id, 'pun', r.pun), auth.uid());
  end loop;
  return jsonb_build_object('pun', v.pun, 'account_no', v.account_no, 'parcel_id', v.id);
end;
$$;
grant execute on function public.parcel_register(uuid, public.land_use, text) to authenticated;

-- The land itself has no bills, so cashiers hear about each unit, not the land.
drop trigger notify_cashiers on public.parcels;
create trigger notify_cashiers after update of status on public.parcels
  for each row when (new.status = 'registered' and old.status is distinct from 'registered' and new.layout = 'house')
  execute function private.notify_cashiers_of_parcel();

-- Deleting: a building or compound goes with all its units, unless money was received on one of them.
alter function public.parcel_delete(uuid, text) set schema private;
alter function private.parcel_delete(uuid, text) rename to parcel_delete_one;
revoke all on function private.parcel_delete_one(uuid, text) from public, anon, authenticated;

create function public.parcel_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  r record;
begin
  select * into v from public.parcels where id = p_id and deleted_at is null;
  if v.parent_id is not null then
    perform private.raise_app_error('CONFLICT', 'unit_follows_land');
  end if;
  for r in select id from public.parcels where parent_id = p_id and deleted_at is null loop
    perform private.parcel_delete_one(r.id, p_reason);
  end loop;
  perform private.parcel_delete_one(p_id, p_reason);
end;
$$;
grant execute on function public.parcel_delete(uuid, text) to authenticated;

-- A certificate is for a unit, not the land above it.
alter function private.certificate_blockers(uuid) rename to certificate_blockers_land;
revoke all on function private.certificate_blockers_land(uuid) from public, anon, authenticated;
create function private.certificate_blockers(p_parcel uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.parcels where id = p_parcel and layout <> 'house') then
    return array['has_units'];
  end if;
  return private.certificate_blockers_land(p_parcel);
end;
$$;
revoke all on function private.certificate_blockers(uuid) from public, anon, authenticated;

-- Yearly bills go to each unit, on its m², and never to the land above it.
alter function private.billing_run_candidates(public.billing_runs) rename to billing_run_candidates_all;
revoke all on function private.billing_run_candidates_all(public.billing_runs) from public, anon, authenticated;
create function private.billing_run_candidates(p_run public.billing_runs)
returns table (parcel_id uuid, district_id uuid, assessment_id uuid, amount numeric, lines jsonb, exception text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.parcel_id, c.district_id, c.assessment_id, c.amount, c.lines, c.exception
    from private.billing_run_candidates_all(p_run) c
    join public.parcels p on p.id = c.parcel_id
   where p.layout = 'house';
$$;
revoke all on function private.billing_run_candidates(public.billing_runs) from public, anon, authenticated;

-- A building's sizes and units are fixed once saved, because the shared m² and the bills were worked out from them.
create or replace function private.land_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.parent_id is not null or old.layout <> 'house')
     and (new.area_m2, new.plot_width_m, new.plot_length_m, new.parent_id, new.layout, new.unit_no, new.own_m2, new.shared_m2)
         is distinct from (old.area_m2, old.plot_width_m, old.plot_length_m, old.parent_id, old.layout, old.unit_no, old.own_m2, old.shared_m2) then
    perform private.raise_app_error('CONFLICT', 'units_fixed');
  end if;
  return new;
end;
$$;
create trigger land_units_guard before update on public.parcels for each row execute function private.land_units_guard();
revoke all on function private.land_units_guard() from public, anon, authenticated;

-- Subdividing or merging doesn't apply to a building or one of its units.
create or replace function private.parcel_change_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.parcels p where p.id = any (new.parcel_ids) and (p.parent_id is not null or p.layout <> 'house')) then
    perform private.raise_app_error('CONFLICT', 'units_no_change');
  end if;
  return new;
end;
$$;
create trigger units_guard before insert on public.parcel_changes for each row execute function private.parcel_change_units_guard();
revoke all on function private.parcel_change_units_guard() from public, anon, authenticated;

-- The land list shows a building once, with its units' owners and what they owe. Searching still finds a unit.
create or replace function public.search_parcels(p_q text, p_limit int default 20)
returns table (id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text,
               created_at timestamptz, house_no text, govt_receipt_no text, invoice text, balance numeric,
               locked_at timestamptz, lock_reason text, application_number text, district_en text, neighbourhood_en text, plot_no text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         coalesce(
           (select string_agg(distinct pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
              join public.parcels o on o.id = po.parcel_id
             where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null)) and po.valid_to is null),
           (select string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) from public.application_parties ap
              join public.parties pa on pa.id = ap.party_id
             where ap.application_id = p.application_id and ap.role in ('owner', 'co_owner'))),
         p.created_at, p.house_no, p.govt_receipt_no,
         (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
          order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1),
         (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
           where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null)) and i.status in ('issued', 'partially_paid')),
         p.locked_at, p.lock_reason, a.number, d.name_en, n.name_en, p.plot_no
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.applications a on a.id = p.application_id
  where p.deleted_at is null and p.status <> 'archived'
    and ((coalesce(trim(p_q), '') = '' and p.parent_id is null)
         or (coalesce(trim(p_q), '') <> '' and (
            p.pun ilike '%' || trim(p_q) || '%'
         or p.account_no ilike trim(p_q) || '%'
         or p.house_no ilike trim(p_q) || '%'
         or p.govt_receipt_no ilike trim(p_q) || '%'
         or a.number ilike trim(p_q) || '%'
         or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
         or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                    where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%')
         or exists (select 1 from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                    where ap.application_id = p.application_id and pa.full_name ilike '%' || trim(p_q) || '%'))))
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- A building is one house in a survey zone and a neighbourhood's counts, however many flats it has.
create or replace function public.survey_zone_list(p_mine boolean default false, p_status text default 'open')
returns table (id uuid, neighbourhood_id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               surveyor_id uuid, surveyor text, target int, note text, status text, assigned_at timestamptz, assigned_by text,
               recorded bigint, partial bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('surveys.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.view');
  end if;
  return query
    select z.id, n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, z.surveyor_id, sp.full_name, z.target, z.note, z.status,
           z.assigned_at, ap.full_name,
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status <> 'archived'),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.survey_zones z
      join public.neighbourhoods n on n.id = z.neighbourhood_id
      join public.districts d on d.id = z.district_id
      left join public.profiles sp on sp.user_id = z.surveyor_id
      left join public.profiles ap on ap.user_id = z.assigned_by
     where (z.surveyor_id = auth.uid() or (not coalesce(p_mine, false) and public.can_access_district(z.district_id)))
       and (coalesce(p_status, 'any') = 'any' or z.status = p_status)
     order by z.status = 'open' desc, z.assigned_at desc
     limit 500;
end;
$$;

create or replace function public.neighbourhood_registration_status(p_district uuid default null)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               has_boundary boolean, partial bigint, open_applications bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('parcels.yet_to_register') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.yet_to_register');
  end if;
  return query
    select n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, coalesce(n.has_geom, false),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.applications a
             where a.neighbourhood_id = n.id and a.status not in ('approved', 'rejected', 'cancelled')),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.neighbourhoods n
      join public.districts d on d.id = n.district_id
     where n.deleted_at is null and d.deleted_at is null
       and public.can_access_district(d.id) and (p_district is null or d.id = p_district)
     order by d.name_en, n.code;
end;
$$;

-- The map shows the land once. Its pin is red when any of its units owes.
create or replace function public.parcel_tile(p_z int, p_x int, p_y int)
returns bytea
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v bytea;
  v_pins bytea;
  v_all boolean;
  v_districts uuid[];
begin
  if p_z < 11 or p_z > 22 or not public.has_permission('map.view') then
    return ''::bytea;
  end if;
  v_all := private.user_has_all_districts(auth.uid());
  v_districts := private.user_district_ids(auth.uid());
  if p_z >= 13 then
    select st_asmvt(t.*, 'parcels') into v from (
      select st_asmvtgeom(st_transform(p.geom, 3857), v_env) as geom, p.id::text as id, p.pun, p.status::text as status,
             p.land_use::text as land_use, p.area_m2::float8 as area_m2, p.application_id::text as application_id,
             p.geom_provisional as provisional
      from public.parcels p
      where p.deleted_at is null and p.parent_id is null and p.status <> 'archived' and (not p.geom_provisional or p.status = 'registered')
        and p.geom && st_transform(v_env, 4326)
        and (v_all or p.district_id = any (v_districts))) t;
  end if;
  select st_asmvt(t.*, 'parcel_pins') into v_pins from (
    select st_asmvtgeom(st_transform(st_pointonsurface(p.geom), 3857), v_env) as geom, p.id::text as id, p.pun, p.house_no,
           exists (select 1 from public.invoices i join public.parcels o on o.id = i.parcel_id
                    where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid')) as owing
    from public.parcels p
    where p.deleted_at is null and p.parent_id is null and p.status = 'registered' and p.geom is not null
      and p.geom && st_transform(v_env, 4326)
      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea) || coalesce(v_pins, ''::bytea);
end;
$$;
