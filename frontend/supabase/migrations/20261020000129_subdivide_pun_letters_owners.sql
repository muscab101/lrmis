-- Subdivide: the new parcels keep the parent's PUN with a letter on the end (BN34KRWJXL0107 -> …0107A, …0107B), and
-- the request can name the owners of each new parcel (payload.owners = one list of party ids per child; an empty or
-- missing list keeps the parent's owners). The first person listed is the owner, the rest co-owners, in equal shares.

/** 1 -> A, 2 -> B … 26 -> Z, 27 -> AA. */
create or replace function private.subdivision_letter(p_n int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_n <= 26 then chr(64 + p_n) else chr(64 + (p_n - 1) / 26) || chr(65 + (p_n - 1) % 26) end;
$$;

/** payload.owners: absent, or one array of party ids per child (each id once, every party existing). */
create or replace function private.validate_subdivision_owners(p_children jsonb, p_owners jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o jsonb;
begin
  if p_owners is null or jsonb_typeof(p_owners) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_owners) <> 'array' or jsonb_array_length(p_owners) <> jsonb_array_length(p_children) then
    perform private.raise_app_error('VALIDATION', 'child_owners');
  end if;
  for o in select * from jsonb_array_elements(p_owners) loop
    if jsonb_typeof(o) <> 'array' or jsonb_array_length(o) > 20
       or (select count(distinct x) from jsonb_array_elements_text(o) x) <> jsonb_array_length(o)
       or exists (select 1 from jsonb_array_elements_text(o) x
                   where x !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.parties p where p.id = x::uuid)) then
      perform private.raise_app_error('VALIDATION', 'child_owners');
    end if;
  end loop;
end;
$$;

/** One parcel of a subdivision: the parent's PUN + letter, a new account number, and its owners. */
create or replace function private.spawn_subdivided(p_template uuid, p_geom extensions.geometry, p_source text, p_letter text, p_owners jsonb)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  t public.parcels;
  v_id uuid;
  v_pun text;
  v_account int;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_owners) = 'array' then p_owners end), 0);
begin
  select * into t from public.parcels where id = p_template;
  v_pun := t.pun || p_letter;
  if exists (select 1 from public.parcels where pun = v_pun) then
    perform private.raise_app_error('CONFLICT', 'pun_taken');
  end if;
  insert into public.pun_counters (district_id) values (t.district_id) on conflict do nothing;
  update public.pun_counters set last_account = last_account + 1 where district_id = t.district_id returning last_account into v_account;
  insert into public.parcels (pun, account_no, district_id, neighbourhood_id, street_id, ownership, land_use, developed, area_m2, perimeter_m, geom,
                              status, registered_at, registered_by, created_by)
  values (v_pun,
          private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'), '{district}{serial:7}'),
                                (select code from public.districts where id = t.district_id), (select code from public.neighbourhoods where id = t.neighbourhood_id), v_account),
          t.district_id, t.neighbourhood_id, t.street_id, t.ownership, t.land_use, t.developed,
          round(st_area(p_geom::geography)::numeric, 2), round(st_perimeter(p_geom::geography)::numeric, 2), p_geom,
          'registered', now(), auth.uid(), auth.uid())
  returning id into v_id;
  if n = 0 then
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, party_id, role, share_pct from public.parcel_owners where parcel_id = p_template and valid_to is null;
  else
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, x::uuid, (case when k = 1 then 'owner' else 'co_owner' end)::public.application_party_role,
           case when k < n then round(100.0 / n, 2) else 100 - round(100.0 / n, 2) * (n - 1) end
      from jsonb_array_elements_text(p_owners) with ordinality as e(x, k);
  end if;
  perform private.parcel_event(v_id, 'created_from', p_source, jsonb_build_object('source_parcel', p_template));
  return v_id;
end;
$$;

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
    perform private.validate_subdivision_owners(p_payload -> 'children', p_payload -> 'owners');
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
  i bigint;
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
    -- The new parcels keep the parent's PUN with A, B, C … on the end, and the owners chosen for each.
    for c, i in select e, n from jsonb_array_elements(v.payload -> 'children') with ordinality as x(e, n) loop
      v_new := v_new || private.spawn_subdivided(v.parcel_ids[1], st_setsrid(st_geomfromgeojson(c::text), 4326), v.number,
                                                 private.subdivision_letter(i::int), v.payload -> 'owners' -> (i::int - 1));
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
