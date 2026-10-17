-- ============================================================================
-- 0031 Location capture in registration and Data Correction after registration.
--  * "Capture location" permission: staff need it to set or move an application's pin.
--  * Each pin records how it was captured (GPS or moved by hand), when, by whom, and whether
--    the GPS accuracy was worse than location.max_accuracy_m (default 15 m).
--  * Plot width × length as declared, compared with the surveyed area.
--  * Data Correction (parcel_changes.kind = 'correction'): after registration, plot / deed /
--    file numbers, ownership, developed and the boundary change only through a request that a
--    second person approves. A new boundary cancels the parcel's documents for reissue.
-- ============================================================================

alter type public.change_kind add value if not exists 'correction';

insert into public.settings (key, value, description) values
  ('location.max_accuracy_m', '15', 'GPS readings less accurate than this (metres) are flagged as low accuracy'),
  ('location.area_tolerance_pct', '20', 'Warn when the surveyed area differs from width × length by more than this (%)')
on conflict (key) do nothing;

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('applications.capture_location', 'applications', 'capture_location', true, 'Capture or move a parcel location', 'Qabo ama beddel goobta dhulka', 350)
on conflict (key) do nothing;
update public.roles set default_permissions = default_permissions || array['applications.capture_location']
 where key in ('front_desk_clerk', 'data_entry_clerk', 'surveyor', 'land_officer', 'registrar', 'gis_officer')
   and not ('applications.capture_location' = any (default_permissions));
insert into public.role_permissions (role_id, permission_key)
select r.id, 'applications.capture_location' from public.roles r
 where r.key in ('front_desk_clerk', 'data_entry_clerk', 'surveyor', 'land_officer', 'registrar', 'gis_officer')
on conflict do nothing;

alter table public.applications
  add column pin_method text check (pin_method in ('gps', 'manual')),
  add column pin_captured_at timestamptz,
  add column pin_captured_by uuid references auth.users (id) on delete set null,
  add column pin_low_accuracy boolean not null default false,
  add column plot_width_m numeric(9, 2) check (plot_width_m is null or plot_width_m > 0),
  add column plot_length_m numeric(9, 2) check (plot_length_m is null or plot_length_m > 0);

/** Records who captured the pin and when; staff need the capture-location permission to set or move it. */
create or replace function private.on_application_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if extensions.st_asbinary(new.pin) is distinct from (case when tg_op = 'UPDATE' then extensions.st_asbinary(old.pin) end) then
    if new.pin is not null and private.caller_is_staff() and not public.has_permission('applications.capture_location') then
      perform private.raise_app_error('PERMISSION_DENIED', 'capture_location');
    end if;
    new.pin_captured_at := case when new.pin is null then null else now() end;
    new.pin_captured_by := case when new.pin is null then null else auth.uid() end;
    if new.pin is null then
      new.pin_method := null;
      new.pin_accuracy_m := null;
    end if;
  end if;
  new.pin_low_accuracy := new.pin is not null
    and (new.pin_method is distinct from 'manual')
    and coalesce(new.pin_accuracy_m, 0) > private.setting_numeric('location.max_accuracy_m', 15);
  return new;
end;
$$;
create trigger application_pin before insert or update on public.applications
  for each row execute function private.on_application_pin();

/** How the pin was captured and the declared plot size (called right after create/update). */
create or replace function public.application_location_meta(p_id uuid, p_method text, p_width numeric, p_length numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
begin
  if p_method is not null and p_method not in ('gps', 'manual') then
    perform private.raise_app_error('VALIDATION', 'pin_method');
  end if;
  if (p_width is not null and (p_width <= 0 or p_width > 5000)) or (p_length is not null and (p_length <= 0 or p_length > 5000)) then
    perform private.raise_app_error('VALIDATION', 'plot_size');
  end if;
  update public.applications
     set pin_method = case when pin is null then null else coalesce(p_method, pin_method) end,
         -- A pin moved by hand has no GPS accuracy.
         pin_accuracy_m = case when p_method = 'manual' then null else pin_accuracy_m end,
         plot_width_m = p_width, plot_length_m = p_length
   where id = p_id;
  return (select jsonb_build_object('pin_method', a.pin_method, 'pin_low_accuracy', a.pin_low_accuracy, 'declared_area_m2', round(a.plot_width_m * a.plot_length_m, 2))
            from public.applications a where a.id = p_id);
end;
$$;
grant execute on function public.application_location_meta(uuid, text, numeric, numeric) to authenticated;
revoke execute on function public.application_location_meta(uuid, text, numeric, numeric) from public, anon;
revoke execute on function private.on_application_pin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data Correction
-- payload: {plot_no?, deed_no?, govt_file_no?, ownership?, developed?, geom? (GeoJSON Polygon)}
-- ---------------------------------------------------------------------------
create or replace function private.validate_correction(p_parcel uuid, p jsonb)
returns void
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v public.parcels;
  g geometry;
  k text;
begin
  select * into v from public.parcels where id = p_parcel;
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then
    perform private.raise_app_error('VALIDATION', 'correction_empty');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('plot_no', 'deed_no', 'govt_file_no', 'ownership', 'developed', 'geom') then
      perform private.raise_app_error('VALIDATION', 'correction_field');
    end if;
  end loop;
  if p ? 'ownership' and (p ->> 'ownership') not in ('public', 'private') then
    perform private.raise_app_error('VALIDATION', 'ownership');
  end if;
  if p ? 'developed' and jsonb_typeof(p -> 'developed') <> 'boolean' then
    perform private.raise_app_error('VALIDATION', 'developed');
  end if;
  if p ? 'geom' then
    if not public.has_permission('applications.capture_location') then
      perform private.raise_app_error('PERMISSION_DENIED', 'capture_location');
    end if;
    begin
      g := st_setsrid(st_geomfromgeojson((p -> 'geom')::text), 4326);
    exception when others then
      perform private.raise_app_error('VALIDATION', 'child_invalid');
    end;
    if geometrytype(g) <> 'POLYGON' or not st_isvalid(g) or st_area(g::geography) < 10 then
      perform private.raise_app_error('VALIDATION', 'child_invalid');
    end if;
    if v.neighbourhood_id is not null and not exists (
         select 1 from public.neighbourhoods n where n.id = v.neighbourhood_id and (n.geom is null or st_intersects(n.geom, st_pointonsurface(g)))) then
      perform private.raise_app_error('VALIDATION', 'outside_neighbourhood');
    end if;
    -- More than 1 m² overlap with a neighbouring registered parcel is refused.
    if exists (select 1 from public.parcels o where o.id <> p_parcel and o.deleted_at is null and o.status in ('registered', 'disputed')
                and st_intersects(o.geom, g) and st_area(st_intersection(o.geom, g)::geography) > 1) then
      perform private.raise_app_error('VALIDATION', 'still_overlapping');
    end if;
  end if;
end;
$$;

create or replace function private.apply_correction(p_parcel uuid, p jsonb, p_number text, p_reason text, p_change uuid)
returns void
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.parcels;
  g geometry;
begin
  perform private.validate_correction(p_parcel, p);
  select * into v from public.parcels where id = p_parcel for update;
  g := case when p ? 'geom' then st_setsrid(st_geomfromgeojson((p -> 'geom')::text), 4326) end;
  update public.parcels
     set plot_no = case when p ? 'plot_no' then nullif(trim(p ->> 'plot_no'), '') else plot_no end,
         deed_no = case when p ? 'deed_no' then nullif(trim(p ->> 'deed_no'), '') else deed_no end,
         govt_file_no = case when p ? 'govt_file_no' then nullif(trim(p ->> 'govt_file_no'), '') else govt_file_no end,
         ownership = case when p ? 'ownership' then (p ->> 'ownership')::public.ownership_type else ownership end,
         developed = case when p ? 'developed' then (p ->> 'developed')::boolean else developed end,
         geom = coalesce(g, geom),
         area_m2 = case when g is null then area_m2 else round(st_area(g::geography)::numeric, 2) end,
         perimeter_m = case when g is null then perimeter_m else round(st_perimeter(g::geography)::numeric, 2) end
   where id = p_parcel;
  -- A certificate shows the boundary, so a new boundary needs new documents.
  if g is not null then
    perform private.cancel_parcel_documents(p_parcel, 'Boundary corrected ' || p_number);
  end if;
  perform private.parcel_event(p_parcel, 'corrected', p_reason,
    jsonb_build_object('change_id', p_change, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p) k),
                       'old', jsonb_build_object('plot_no', v.plot_no, 'deed_no', v.deed_no, 'govt_file_no', v.govt_file_no, 'ownership', v.ownership,
                                                 'developed', v.developed, 'area_m2', v.area_m2)));
end;
$$;
revoke execute on function private.validate_correction(uuid, jsonb), private.apply_correction(uuid, jsonb, text, text, uuid) from public, anon, authenticated;

create or replace function public.parcel_change_request(p_kind public.change_kind, p_parcels uuid[], p_payload jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.parcels;
  v_id uuid;
  pid uuid;
  v_first uuid := p_parcels[1];
begin
  perform private.assert_permission('parcels.update');
  if p_parcels is null or cardinality(p_parcels) = 0 then
    perform private.raise_app_error('VALIDATION', 'parcels');
  end if;
  foreach pid in array p_parcels loop
    v := private.scoped_parcel(pid);
    perform private.assert_no_blockers(pid, p_kind::text);
  end loop;
  select * into v from public.parcels where id = v_first;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;

  if p_kind = 'subdivide' then
    if cardinality(p_parcels) <> 1 then
      perform private.raise_app_error('VALIDATION', 'parcels');
    end if;
    perform private.validate_subdivision(v_first, p_payload -> 'children');
  elsif p_kind = 'merge' then
    if cardinality(p_parcels) < 2 or cardinality(p_parcels) > 10 then
      perform private.raise_app_error('VALIDATION', 'parcels');
    end if;
    if (select count(distinct neighbourhood_id) from public.parcels where id = any (p_parcels)) > 1 then
      perform private.raise_app_error('VALIDATION', 'merge_neighbourhood');
    end if;
    -- Same owners with the same shares on every parcel.
    if (select count(distinct x) from (
          select string_agg(po.party_id::text || ':' || coalesce(po.share_pct, 0)::text, ',' order by po.party_id) x
          from unnest(p_parcels) q(id) join public.parcel_owners po on po.parcel_id = q.id and po.valid_to is null group by q.id) s) <> 1 then
      perform private.raise_app_error('VALIDATION', 'merge_owners');
    end if;
    if geometrytype(st_union(array(select st_snap(geom, (select st_collect(geom) from public.parcels where id = any (p_parcels)), 0.000005) from public.parcels where id = any (p_parcels)))) <> 'POLYGON' then
      perform private.raise_app_error('VALIDATION', 'merge_not_touching');
    end if;
  elsif p_kind = 'change_of_use' then
    if cardinality(p_parcels) <> 1 or (p_payload ->> 'land_use') is null or (p_payload ->> 'land_use')::public.land_use = v.land_use then
      perform private.raise_app_error('VALIDATION', 'land_use');
    end if;
  elsif p_kind = 'correction' then
    if cardinality(p_parcels) <> 1 then
      perform private.raise_app_error('VALIDATION', 'parcels');
    end if;
    perform private.validate_correction(v_first, p_payload);
  end if;

  insert into public.parcel_changes (number, kind, parcel_ids, district_id, payload, reason, requested_by)
  values (private.serial('PCH'), p_kind, p_parcels, v.district_id, coalesce(p_payload, '{}'::jsonb), trim(p_reason), auth.uid())
  returning id into v_id;
  foreach pid in array p_parcels loop
    perform private.parcel_event(pid, 'change_requested', p_reason, jsonb_build_object('change_id', v_id, 'kind', p_kind));
  end loop;
  return v_id;
end;
$$;

create or replace function public.parcel_change_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.parcel_changes;
  pid uuid;
  c jsonb;
  v_new uuid[] := '{}';
  v_geom geometry;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.parcel_changes where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'change');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.parcel_changes set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  foreach pid in array v.parcel_ids loop
    perform private.assert_no_blockers(pid, v.kind::text, p_id);
  end loop;

  if v.kind = 'subdivide' then
    perform private.validate_subdivision(v.parcel_ids[1], v.payload -> 'children');
    for c in select * from jsonb_array_elements(v.payload -> 'children') loop
      v_new := v_new || private.spawn_parcel(v.parcel_ids[1], st_setsrid(st_geomfromgeojson(c::text), 4326), v.number);
    end loop;
  elsif v.kind = 'merge' then
    select st_union(array(select st_snap(geom, (select st_collect(geom) from public.parcels where id = any (v.parcel_ids)), 0.000005)
                          from public.parcels where id = any (v.parcel_ids))) into v_geom;
    if geometrytype(v_geom) <> 'POLYGON' then
      perform private.raise_app_error('VALIDATION', 'merge_not_touching');
    end if;
    v_new := array[private.spawn_parcel(v.parcel_ids[1], v_geom, v.number)];
  elsif v.kind = 'correction' then
    perform private.apply_correction(v.parcel_ids[1], v.payload, v.number, v.reason, p_id);
  else
    update public.parcels set land_use = (v.payload ->> 'land_use')::public.land_use where id = v.parcel_ids[1];
    perform private.parcel_event(v.parcel_ids[1], 'use_changed', v.reason, jsonb_build_object('change_id', p_id, 'land_use', v.payload ->> 'land_use'));
  end if;

  if v.kind in ('subdivide', 'merge') then
    foreach pid in array v.parcel_ids loop
      update public.parcels set status = 'archived' where id = pid;
      update public.parcel_owners set valid_to = current_date where parcel_id = pid and valid_to is null;
      perform private.cancel_parcel_documents(pid, v.kind::text || ' ' || v.number);
      perform private.parcel_event(pid, v.kind::text || 'd', v.reason, jsonb_build_object('change_id', p_id, 'new_parcels', to_jsonb(v_new)));
    end loop;
  end if;
  update public.parcel_changes set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), result_parcel_ids = v_new
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'new_parcels', to_jsonb(v_new));
end;
$$;
