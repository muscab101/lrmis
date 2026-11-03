-- Demolished houses (owner decision 2026-11-03). Nothing is deleted or overwritten: when a demolition is approved, a frozen
-- copy of the original place, house number, owners, boundary and balances goes into the archive, and the land keeps its PUN.
-- A surveyor asks; a registrar or admin approves (and can mark it at once). A whole neighbourhood can be marked together.
-- Until the land is registered again it pays land tax at the Empty Land grade. Old bills and unpaid balances stay.
-- A flats building goes as a whole; a compound house can go alone. A land with units becomes one land when its units go.
-- Registering again keeps the PUN, gives a new building number, and the same or a new owner; the demolished record stays.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values
  ('parcels.demolitions', 'parcels', 'demolitions', true, 'See the demolished properties archive', 'Arag kaydka guryaha la dumiyay', 266),
  ('parcels.demolish', 'parcels', 'demolish', true, 'Ask to mark properties as demolished', 'Codso in guryo loo calaamadiyo la dumiyay', 267),
  ('parcels.demolish_approve', 'parcels', 'demolish_approve', true, 'Approve demolitions and register demolished land again', 'Oggolow dumista oo dib u diiwaangeli dhulka', 268)
on conflict (key) do nothing;

do $$
declare
  g record;
begin
  for g in
    select * from (values
      ('parcels.demolitions', array['admin', 'registrar', 'land_officer', 'gis_officer', 'surveyor', 'billing_officer', 'revenue_collector', 'valuation_officer', 'finance_manager', 'auditor', 'executive', 'legal_officer', 'inspector', 'planning_officer']),
      ('parcels.demolish', array['admin', 'registrar', 'land_officer', 'gis_officer', 'surveyor']),
      ('parcels.demolish_approve', array['admin', 'registrar'])
    ) as t(perm, roles)
  loop
    insert into public.role_permissions (role_id, permission_key)
    select r.id, g.perm from public.roles r where r.key = any (g.roles) on conflict do nothing;
    update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array[g.perm]) x)
     where key = any (g.roles);
  end loop;
end $$;

alter table public.parcels
  add column building_state text not null default 'standing' check (building_state in ('standing', 'demolished')),
  add column building_no text unique;

create table public.demolitions (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  parcel_id       uuid not null references public.parcels (id),
  batch_id        uuid not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'restored')),
  -- The place and identity at the time, for searching; the full copy is in snapshot.
  district_id     uuid not null references public.districts (id),
  section_id      uuid,
  sector_id       uuid,
  neighbourhood_id uuid,
  pun             text,
  house_no        text,
  owner_names     text,
  demolition_date date not null,
  reason          text not null check (length(trim(reason)) between 5 and 1000),
  notes           text check (notes is null or length(notes) <= 2000),
  demolished_by   text check (demolished_by is null or length(demolished_by) <= 200),
  snapshot        jsonb not null,
  -- Owners copied onto the land when its units went, so a mistaken demolition can be undone.
  added_owner_ids uuid[] not null default '{}',
  requested_by    uuid references auth.users (id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  archived_at     timestamptz,
  restored_by     uuid references auth.users (id) on delete set null,
  restored_at     timestamptz,
  restore_reason  text,
  -- Registered again: the new building, its house number and owner.
  rebuilt_at      timestamptz,
  rebuilt_by      uuid references auth.users (id) on delete set null,
  building_no     text,
  new_house_no    text,
  new_owner_names text,
  rebuild_note    text
);
alter table public.demolitions enable row level security;
create index demolitions_parcel_idx on public.demolitions (parcel_id);
create index demolitions_status_idx on public.demolitions (status, demolition_date desc);
create index demolitions_place_idx on public.demolitions (district_id, section_id, sector_id, neighbourhood_id);
-- One demolition at a time on a land: waiting, or approved and not yet registered again.
create unique index demolitions_one_open_uidx on public.demolitions (parcel_id)
  where status = 'pending' or (status = 'approved' and rebuilt_at is null);
create trigger audit after insert or update or delete on public.demolitions for each row execute function private.audit_row();

create policy demolitions_read on public.demolitions for select to authenticated
  using (public.has_permission('parcels.demolitions') and public.can_access_district(district_id));

/** A copy of the land as it stands now: place, owners, boundary, its units and what is owed. */
create or replace function private.demolition_snapshot(p_parcel uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pun', p.pun, 'account_no', p.account_no, 'house_no', p.house_no, 'flat_no', p.flat_no, 'plot_no', p.plot_no, 'deed_no', p.deed_no,
    'status', p.status, 'layout', p.layout, 'floors', p.floors, 'parent_id', p.parent_id, 'unit_no', p.unit_no,
    'area_m2', p.area_m2, 'plot_width_m', p.plot_width_m, 'plot_length_m', p.plot_length_m, 'land_use', p.land_use,
    'property_type', p.property_type, 'grade_en', g.name_en, 'grade_so', g.name_so, 'registered_at', p.registered_at,
    'district', jsonb_build_object('id', d.id, 'code', d.code, 'name_so', d.name_so, 'name_en', d.name_en),
    'section', case when se.id is not null then jsonb_build_object('id', se.id, 'code', se.code, 'name_so', se.name_so, 'name_en', se.name_en) end,
    'sector', case when sc.id is not null then jsonb_build_object('id', sc.id, 'code', sc.code, 'name_so', sc.name_so, 'name_en', sc.name_en) end,
    'neighbourhood', case when n.id is not null then jsonb_build_object('id', n.id, 'code', n.code, 'name_so', n.name_so, 'name_en', n.name_en) end,
    'centroid', extensions.st_asgeojson(p.centroid)::jsonb,
    'geom', extensions.st_asgeojson(p.geom)::jsonb,
    'owners', coalesce((select jsonb_agg(jsonb_build_object('party_id', pa.id, 'full_name', pa.full_name, 'phone', pa.phone, 'id_number', pa.id_number, 'role', po.role, 'share_pct', po.share_pct, 'valid_from', po.valid_from))
                 from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = p.id and po.valid_to is null), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'pun', u.pun, 'unit_no', u.unit_no, 'floor', u.unit_floor, 'area_m2', u.area_m2, 'own_m2', u.own_m2, 'shared_m2', u.shared_m2,
                   'house_no', u.house_no, 'property_type', u.property_type, 'status', u.status, 'building_state', u.building_state,
                   'owners', (select coalesce(jsonb_agg(jsonb_build_object('party_id', pa.id, 'full_name', pa.full_name, 'phone', pa.phone, 'role', po.role)), '[]'::jsonb)
                                from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = u.id and po.valid_to is null)) order by u.unit_no)
                 from public.parcels u where u.parent_id = p.id and u.deleted_at is null), '[]'::jsonb),
    'shared_spaces', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'area_m2', s.area_m2)) from public.parcel_shared_spaces s where s.parcel_id = p.id), '[]'::jsonb),
    'balance', (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
                 where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid')))
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.sectors sc on sc.id = n.sector_id
  left join public.sections se on se.id = sc.section_id
  left join public.property_grades g on g.code = p.property_type
  where p.id = p_parcel;
$$;
revoke all on function private.demolition_snapshot(uuid) from public, anon, authenticated;

/** Why this land can't be marked as demolished now, or null. */
create or replace function private.demolition_blocker(p public.parcels)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent public.parcels;
begin
  if p.id is null or p.deleted_at is not null or not public.can_access_district(p.district_id) then
    return 'demolish_not_found';
  end if;
  if p.status <> 'registered' then
    return 'demolish_not_registered';
  end if;
  if p.building_state = 'demolished' then
    return 'demolish_already';
  end if;
  if p.locked_at is not null then
    return 'locked';
  end if;
  if p.parent_id is not null then
    select * into v_parent from public.parcels where id = p.parent_id;
    if v_parent.layout = 'flats' then
      return 'demolish_whole_building';
    end if;
  end if;
  if exists (select 1 from public.demolitions d where d.parcel_id = p.id and d.status = 'pending') then
    return 'demolish_waiting';
  end if;
  return null;
end;
$$;
revoke all on function private.demolition_blocker(public.parcels) from public, anon, authenticated;

/** The approval takes effect: the frozen copy is taken, the building stops being taxed and the land pays as empty land. */
create or replace function private.demolition_apply(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.demolitions;
  p public.parcels;
  v_empty text;
  v_snapshot jsonb;
  v_added uuid[] := '{}';
  v_owners uuid[];
  v_new uuid;
  r record;
begin
  select * into v from public.demolitions where id = p_id for update;
  select * into p from public.parcels where id = v.parcel_id for update;
  select code into v_empty from public.property_grades where active and lower(name_en) = 'empty land' limit 1;
  if v_empty is null then
    perform private.raise_app_error('CONFLICT', 'demolish_no_empty_grade');
  end if;
  v_snapshot := private.demolition_snapshot(p.id);

  if p.layout <> 'house' then
    -- The units end, and whoever owned them still holds the land until it is registered again.
    v_owners := array(select distinct po.party_id from public.parcel_owners po join public.parcels u on u.id = po.parcel_id
                       where u.parent_id = p.id and u.deleted_at is null and u.building_state = 'standing' and po.valid_to is null);
    if cardinality(v_owners) = 0 then
      v_owners := array(select distinct po.party_id from public.parcel_owners po join public.parcels u on u.id = po.parcel_id
                         where u.parent_id = p.id and u.deleted_at is null and po.valid_to is null);
    end if;
    for r in select unnest(v_owners) as party_id loop
      insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
      values (p.id, r.party_id, case when cardinality(v_owners) = 1 then 'owner' else 'co_owner' end::public.application_party_role, round(100.0 / cardinality(v_owners), 2))
      returning id into v_new;
      v_added := v_added || v_new;
    end loop;
    for r in select id from public.parcels where parent_id = p.id and deleted_at is null and status <> 'archived' loop
      update public.parcels set status = 'archived', building_state = 'demolished' where id = r.id;
      perform private.parcel_event(r.id, 'demolished', v.reason, jsonb_build_object('demolition', v.number));
    end loop;
    perform set_config('app.land_change', 'on', true);
    update public.parcels set layout = 'house' where id = p.id;
    perform set_config('app.land_change', '', true);
  end if;

  update public.parcels set building_state = 'demolished', property_type = v_empty where id = p.id;
  update public.demolitions
     set status = 'approved', snapshot = v_snapshot, owner_names = (select string_agg(x ->> 'full_name', ', ')
           from jsonb_array_elements(coalesce(nullif(v_snapshot -> 'owners', '[]'::jsonb), (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements(v_snapshot -> 'units') u, jsonb_array_elements(u -> 'owners') o))) x),
         added_owner_ids = v_added, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), archived_at = now()
   where id = p_id;
  perform private.parcel_event(p.id, 'demolished', v.reason, jsonb_build_object('demolition', v.number, 'date', v.demolition_date));
end;
$$;
revoke all on function private.demolition_apply(uuid, text) from public, anon, authenticated;

/** Ask to mark land as demolished, one or a whole neighbourhood's. Someone who can approve may mark it at once. */
create or replace function public.demolition_request(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'parcel_ids', '[]'::jsonb)) x);
  v_date date := nullif(p ->> 'demolition_date', '')::date;
  v_reason text := trim(coalesce(p ->> 'reason', ''));
  v_notes text := nullif(trim(coalesce(p ->> 'notes', '')), '');
  v_by text := nullif(trim(coalesce(p ->> 'demolished_by', '')), '');
  v_now boolean := coalesce((p ->> 'approve_now')::boolean, false);
  v_batch uuid := gen_random_uuid();
  v_id uuid;
  v_pid uuid;
  v_block text;
  v_snap jsonb;
  v_year int := extract(year from current_date)::int;
  x public.parcels;
  r record;
  v_first text;
  v_district uuid;
begin
  if not public.has_permission('parcels.demolish') and not public.has_permission('parcels.demolish_approve') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.demolish');
  end if;
  if v_now and not public.has_permission('parcels.demolish_approve') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.demolish_approve');
  end if;
  if cardinality(v_ids) not between 1 and 1000 then
    perform private.raise_app_error('VALIDATION', 'demolish_selection');
  end if;
  if v_date is null or v_date > current_date then
    perform private.raise_app_error('VALIDATION', 'demolish_date');
  end if;
  if length(v_reason) not between 5 and 1000 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  foreach v_pid in array v_ids loop
    select * into x from public.parcels where id = v_pid for update;
    v_block := private.demolition_blocker(x);
    if v_block is not null then
      perform private.raise_app_error(case when v_block = 'demolish_not_found' then 'NOT_FOUND' else 'CONFLICT' end, v_block);
    end if;
    v_snap := private.demolition_snapshot(v_pid);
    insert into public.demolitions (number, parcel_id, batch_id, district_id, section_id, sector_id, neighbourhood_id, pun, house_no, owner_names,
                                    demolition_date, reason, notes, demolished_by, snapshot, requested_by)
    values ('DEM-' || v_year || '-' || lpad(private.next_serial('DEM-' || v_year)::text, 6, '0'), v_pid, v_batch, x.district_id,
            (v_snap #>> '{section,id}')::uuid, (v_snap #>> '{sector,id}')::uuid, x.neighbourhood_id, x.pun, x.house_no,
            (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(v_snap -> 'owners') o),
            v_date, v_reason, v_notes, v_by, v_snap, auth.uid())
    returning id into v_id;
    if v_now then
      perform private.demolition_apply(v_id, null);
    end if;
    v_first := coalesce(v_first, x.pun);
    v_district := x.district_id;
  end loop;
  if not v_now then
    for r in
      select distinct pr.user_id from public.profiles pr
       where pr.kind = 'staff' and pr.status = 'active' and pr.deleted_at is null and pr.user_id <> auth.uid()
         and not private.user_grants_all(pr.user_id)
         and private.user_can_access_district(pr.user_id, v_district)
         and private.user_has_permission(pr.user_id, 'parcels.demolish_approve')
    loop
      perform private.notify(r.user_id, 'demolition.request',
        'Codsi dumis ayaa sugaya: ' || v_first || case when cardinality(v_ids) > 1 then ' +' || (cardinality(v_ids) - 1) else '' end,
        'A demolition is waiting: ' || v_first || case when cardinality(v_ids) > 1 then ' +' || (cardinality(v_ids) - 1) else '' end,
        '/demolished?tab=pending');
    end loop;
  end if;
  return jsonb_build_object('batch_id', v_batch, 'count', cardinality(v_ids), 'approved', v_now);
end;
$$;
grant execute on function public.demolition_request(jsonb) to authenticated;

create or replace function public.demolition_decide(p_ids uuid[], p_approve boolean, p_note text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.demolitions;
  v_id uuid;
  v_n int := 0;
begin
  perform private.assert_permission('parcels.demolish_approve');
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  foreach v_id in array p_ids loop
    select * into v from public.demolitions where id = v_id for update;
    if v.id is null or not public.can_access_district(v.district_id) then
      perform private.raise_app_error('NOT_FOUND', 'demolition');
    end if;
    if v.status <> 'pending' then
      perform private.raise_app_error('CONFLICT', 'decided');
    end if;
    if p_approve then
      perform private.demolition_apply(v_id, p_note);
    else
      update public.demolitions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = v_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function public.demolition_decide(uuid[], boolean, text) to authenticated;

/** Marked by mistake: the land goes back as it was. The record stays, marked restored. */
create or replace function public.demolition_restore(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.demolitions;
  u jsonb;
begin
  perform private.assert_permission('parcels.demolish_approve');
  select * into v from public.demolitions where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'demolition');
  end if;
  if v.status <> 'approved' or v.rebuilt_at is not null then
    perform private.raise_app_error('CONFLICT', 'demolish_cannot_restore');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  delete from public.parcel_owners where id = any (v.added_owner_ids);
  if coalesce(v.snapshot ->> 'layout', 'house') <> 'house' then
    perform set_config('app.land_change', 'on', true);
    update public.parcels set layout = v.snapshot ->> 'layout' where id = v.parcel_id;
    perform set_config('app.land_change', '', true);
    for u in select value from jsonb_array_elements(v.snapshot -> 'units') loop
      update public.parcels set status = (u ->> 'status')::public.parcel_status, building_state = u ->> 'building_state' where id = (u ->> 'id')::uuid;
    end loop;
  end if;
  update public.parcels set building_state = 'standing', property_type = v.snapshot ->> 'property_type' where id = v.parcel_id;
  update public.demolitions set status = 'restored', restored_by = auth.uid(), restored_at = now(), restore_reason = trim(p_reason), archived_at = null where id = p_id;
  perform private.parcel_event(v.parcel_id, 'demolition_restored', trim(p_reason), jsonb_build_object('demolition', v.number));
end;
$$;
grant execute on function public.demolition_restore(uuid, text) to authenticated;

/**
 * A new house on demolished land: the same PUN, a new building number, the same owner or a new one. The demolished record
 * stays in the archive, linked to the new building. Old unpaid bills stay; the yearly run bills the new house from next year.
 */
create or replace function public.demolition_reregister(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.demolitions;
  x public.parcels;
  v_keep boolean := coalesce((p ->> 'keep_owner')::boolean, false);
  v_owner uuid := nullif(p ->> 'owner_id', '')::uuid;
  v_name text := nullif(trim(coalesce(p ->> 'owner_name', '')), '');
  v_phone text := nullif(trim(coalesce(p ->> 'owner_phone', '')), '');
  v_type text := nullif(trim(coalesce(p ->> 'property_type', '')), '');
  v_house text := nullif(trim(coalesce(p ->> 'house_no', '')), '');
  v_note text := nullif(trim(coalesce(p ->> 'note', '')), '');
  v_year int := extract(year from current_date)::int;
  v_building text;
  v_service public.fee_types;
  v_names text;
begin
  perform private.assert_permission('parcels.demolish_approve');
  select * into v from public.demolitions where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'demolition');
  end if;
  if v.status <> 'approved' or v.rebuilt_at is not null then
    perform private.raise_app_error('CONFLICT', 'demolish_cannot_rebuild');
  end if;
  select * into x from public.parcels where id = v.parcel_id for update;
  if v_type is null or not exists (select 1 from public.property_grades g where g.code = v_type and g.active) then
    perform private.raise_app_error('VALIDATION', 'property_type');
  end if;
  v_house := coalesce(v_house, x.house_no);
  if v_house is distinct from x.house_no and exists (select 1 from private.house_numbers_in_use(x.neighbourhood_id, null) u where u.house_no = v_house) then
    perform private.raise_app_error('CONFLICT', 'house_no_taken');
  end if;
  if not v_keep then
    if v_owner is not null then
      if not exists (select 1 from public.parties pa where pa.id = v_owner and pa.deleted_at is null) then
        perform private.raise_app_error('NOT_FOUND', 'owner');
      end if;
    elsif v_name is null or length(v_name) < 3 then
      perform private.raise_app_error('VALIDATION', 'owner_name');
    else
      insert into public.parties (kind, full_name, phone, district_id, created_by)
      values ('person', v_name, v_phone, x.district_id, auth.uid()) returning id into v_owner;
    end if;
    update public.parcel_owners set valid_to = current_date where parcel_id = x.id and valid_to is null and party_id is distinct from v_owner;
    if not exists (select 1 from public.parcel_owners where parcel_id = x.id and party_id = v_owner and valid_to is null) then
      insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (x.id, v_owner, 'owner', 100);
    else
      update public.parcel_owners set role = 'owner', share_pct = 100 where parcel_id = x.id and party_id = v_owner and valid_to is null;
    end if;
    -- The papers were for the old owner.
    update public.issued_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Registered again: ' || v.number
     where parcel_id = x.id and status = 'valid';
  elsif not exists (select 1 from public.parcel_owners where parcel_id = x.id and valid_to is null) then
    perform private.raise_app_error('CONFLICT', 'no_owner');
  end if;
  update public.parties set registered_at = now(), registered_by = auth.uid()
   where registered_at is null and id in (select party_id from public.parcel_owners where parcel_id = x.id and valid_to is null);

  v_building := 'BLD-' || v_year || '-' || lpad(private.next_serial('BLD-' || v_year)::text, 6, '0');
  update public.parcels set building_state = 'standing', building_no = v_building, property_type = v_type, house_no = v_house where id = x.id;
  select string_agg(pa.full_name, ', ') into v_names from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = x.id and po.valid_to is null;
  update public.demolitions
     set rebuilt_at = now(), rebuilt_by = auth.uid(), building_no = v_building, new_house_no = v_house, new_owner_names = v_names, rebuild_note = v_note
   where id = p_id;
  -- Registering a house carries the service charge, as for any new house.
  select * into v_service from public.fee_types where code = 'service_charge' and active and coalesce(amount, 0) > 0;
  if v_service.id is not null then
    perform private.parcel_raise_invoice(x.id, 'service_charge', round(v_service.amount, 2), coalesce(v_service.name_en, 'Service charge') || ' — ' || x.pun || ' · ' || v_building, 'service');
  end if;
  perform private.parcel_event(x.id, 'registered_again', v_note, jsonb_build_object('demolition', v.number, 'building_no', v_building));
  return jsonb_build_object('building_no', v_building, 'pun', x.pun, 'parcel_id', x.id);
end;
$$;
grant execute on function public.demolition_reregister(uuid, jsonb) to authenticated;

/** Land that can be marked: registered, standing, in the place and matching the search. */
create or replace function public.demolition_candidates(p_district uuid default null, p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null, p_q text default '', p_limit int default 1000)
returns table (id uuid, pun text, house_no text, layout text, area_m2 numeric, owners text, neighbourhood text, district text, balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_permission('parcels.demolish') and not public.has_permission('parcels.demolish_approve') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.demolish');
  end if;
  -- Nothing until a place or a search narrows it.
  if p_district is null and p_section is null and p_sector is null and p_neighbourhood is null and v_q is null then
    return;
  end if;
  return query
  select p.id, p.pun, p.house_no, p.layout, p.area_m2,
         (select string_agg(distinct pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id join public.parcels o on o.id = po.parcel_id
           where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null)) and po.valid_to is null),
         n.code, d.name_en,
         (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
           where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid'))
    from public.parcels p
    join public.districts d on d.id = p.district_id
    left join public.neighbourhoods n on n.id = p.neighbourhood_id
    left join public.sectors sc on sc.id = n.sector_id
    left join public.parcels parent on parent.id = p.parent_id
   where p.deleted_at is null and p.status = 'registered' and p.building_state = 'standing' and p.locked_at is null
     and public.can_access_district(p.district_id)
     and (p.parent_id is null or parent.layout = 'compound')
     and not exists (select 1 from public.demolitions dm where dm.parcel_id = p.id and dm.status = 'pending')
     and (p_district is null or p.district_id = p_district)
     and (p_section is null or sc.section_id = p_section)
     and (p_sector is null or n.sector_id = p_sector)
     and (p_neighbourhood is null or p.neighbourhood_id = p_neighbourhood)
     and (v_q is null or p.pun ilike '%' || v_q || '%' or p.account_no ilike v_q || '%' or p.house_no ilike v_q || '%')
   order by p.pun
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;
grant execute on function public.demolition_candidates(uuid, uuid, uuid, uuid, text, int) to authenticated;

/** The archive's numbers, for the places this person can see. */
create or replace function public.demolition_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_permission('parcels.demolitions');
  with done as (
    select * from public.demolitions d where d.status = 'approved' and public.can_access_district(d.district_id)
  )
  select jsonb_build_object(
    'total', (select count(*) from done),
    'this_year', (select count(*) from done where extract(year from demolition_date) = extract(year from current_date)),
    'waiting', (select count(*) from public.demolitions d where d.status = 'pending' and public.can_access_district(d.district_id)),
    'rebuilt', (select count(*) from done where rebuilt_at is not null),
    'outstanding', (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
                     where i.status in ('issued', 'partially_paid')
                       and (o.id in (select parcel_id from done) or o.parent_id in (select parcel_id from done))),
    'by_district', (select coalesce(jsonb_agg(t order by t.count desc, t.name), '[]'::jsonb) from (
        select x.name_en as name, x.name_so, count(*) as count from done join public.districts x on x.id = done.district_id group by 1, 2) t),
    'by_sector', (select coalesce(jsonb_agg(t order by t.count desc, t.name), '[]'::jsonb) from (
        select x.code || ' · ' || x.name_en as name, x.code || ' · ' || x.name_so as name_so, count(*) as count from done join public.sectors x on x.id = done.sector_id group by 1, 2) t),
    'by_neighbourhood', (select coalesce(jsonb_agg(t order by t.count desc, t.name), '[]'::jsonb) from (
        select x.code as name, x.code as name_so, count(*) as count from done join public.neighbourhoods x on x.id = done.neighbourhood_id group by 1, 2) t)
  ) into v;
  return v;
end;
$$;
grant execute on function public.demolition_stats() to authenticated;

/** One archive record's tax history and audit trail. */
create or replace function public.demolition_history(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.demolitions;
begin
  perform private.assert_permission('parcels.demolitions');
  select * into v from public.demolitions where id = p_id;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'demolition');
  end if;
  return jsonb_build_object(
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'pun', o.pun, 'fee_en', ft.name_en, 'fee_so', ft.name_so, 'period', i.period, 'issue_date', i.issue_date,
                   'total', i.total, 'paid', i.paid, 'balance', i.balance, 'status', i.status) order by i.issue_date desc, i.number desc), '[]'::jsonb)
                 from public.invoices i join public.parcels o on o.id = i.parcel_id left join public.fee_types ft on ft.id = i.fee_type_id
                 where o.id = v.parcel_id or o.parent_id = v.parcel_id),
    'owner_history', (select coalesce(jsonb_agg(jsonb_build_object('full_name', pa.full_name, 'phone', pa.phone, 'role', po.role, 'pun', o.pun, 'valid_from', po.valid_from, 'valid_to', po.valid_to) order by po.valid_from desc), '[]'::jsonb)
                 from public.parcel_owners po join public.parties pa on pa.id = po.party_id join public.parcels o on o.id = po.parcel_id
                 where o.id = v.parcel_id or o.parent_id = v.parcel_id),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'status', d.status, 'house_no', d.house_no, 'demolition_date', d.demolition_date, 'building_no', d.building_no, 'new_house_no', d.new_house_no) order by d.requested_at), '[]'::jsonb)
                 from public.demolitions d where d.parcel_id = v.parcel_id and d.id <> v.id),
    'names', jsonb_build_object(
       'requested_by', (select full_name from public.profiles where user_id = v.requested_by),
       'decided_by', (select full_name from public.profiles where user_id = v.decided_by),
       'restored_by', (select full_name from public.profiles where user_id = v.restored_by),
       'rebuilt_by', (select full_name from public.profiles where user_id = v.rebuilt_by)),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'by', a.actor_email) order by a.at desc), '[]'::jsonb)
                 from public.audit_log a where a.table_name = 'demolitions' and a.record_id = p_id::text));
end;
$$;
grant execute on function public.demolition_history(uuid) to authenticated;

-- A land's layout may change only when its units are demolished or restored.
create or replace function private.land_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.land_change', true) = 'on' then
    return new;
  end if;
  if (old.parent_id is not null or old.layout <> 'house')
     and (new.area_m2, new.plot_width_m, new.plot_length_m, new.parent_id, new.layout, new.unit_no, new.own_m2, new.shared_m2)
         is distinct from (old.area_m2, old.plot_width_m, old.plot_length_m, old.parent_id, old.layout, old.unit_no, old.own_m2, old.shared_m2) then
    perform private.raise_app_error('CONFLICT', 'units_fixed');
  end if;
  return new;
end;
$$;

-- The map says which land is demolished, so it can be drawn apart and filtered. Its boundary stays on the map.
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
             p.geom_provisional as provisional, p.building_state = 'demolished' as demolished
      from public.parcels p
      where p.deleted_at is null and p.parent_id is null and p.status <> 'archived' and (not p.geom_provisional or p.status = 'registered')
        and p.geom && st_transform(v_env, 4326)
        and (v_all or p.district_id = any (v_districts))) t;
  end if;
  select st_asmvt(t.*, 'parcel_pins') into v_pins from (
    select st_asmvtgeom(st_transform(st_pointonsurface(p.geom), 3857), v_env) as geom, p.id::text as id, p.pun, p.house_no,
           exists (select 1 from public.invoices i join public.parcels o on o.id = i.parcel_id
                    where (o.id = p.id or o.parent_id = p.id) and i.status in ('issued', 'partially_paid')) as owing,
           p.building_state = 'demolished' as demolished
    from public.parcels p
    where p.deleted_at is null and p.parent_id is null and p.status = 'registered' and p.geom is not null
      and p.geom && st_transform(v_env, 4326)
      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea) || coalesce(v_pins, ''::bytea);
end;
$$;
