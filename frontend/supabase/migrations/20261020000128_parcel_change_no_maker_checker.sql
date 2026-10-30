-- The person who requested a parcel change (subdivide, merge, change of use, correction) may approve it too (owner
-- decision 2026-10-31, as for transfers in 0109).
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
