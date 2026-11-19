-- Remapping is given to a surveyor: staff who look after land choose a surveyor on the land's page ("Assign
-- remapping"); the job shows on that surveyor's Surveys page (Remapping tab); the surveyor goes to the land, remaps
-- it, and the job is done. The surveyor may see the land while the job is open, as with a site check.

alter table public.parcels
  add column if not exists remap_status text check (remap_status in ('assigned', 'done')),
  add column if not exists remap_surveyor uuid references auth.users(id),
  add column if not exists remap_requested_at timestamptz,
  add column if not exists remap_requested_by uuid references auth.users(id),
  add column if not exists remap_note text,
  add column if not exists remap_done_at timestamptz;

create index if not exists parcels_remap_open_idx on public.parcels (remap_surveyor, remap_requested_at)
  where remap_status = 'assigned' and deleted_at is null;

-- Who may give out remapping: the same staff who may ask for a site check.
create or replace function private.can_assign_remap()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('parcels.update') or public.has_permission('parcels.approve') or public.has_permission('surveys.approve');
$$;

-- Surveyors who can remap land in this land's district (they capture locations), least busy first.
create or replace function public.parcel_remap_candidates(p_id uuid)
returns table(user_id uuid, full_name text, open_remaps bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_district uuid;
begin
  if not private.can_assign_remap() then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap_assign');
  end if;
  select district_id into v_district from public.parcels where id = p_id and deleted_at is null;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return query
    select p.user_id, p.full_name,
           (select count(*) from public.parcels x where x.remap_surveyor = p.user_id and x.remap_status = 'assigned' and x.deleted_at is null)
      from public.profiles p
     where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
       and not private.user_grants_all(p.user_id)
       and private.user_has_permission(p.user_id, 'surveys.create')
       and private.user_has_permission(p.user_id, 'applications.capture_location')
       and private.user_can_access_district(p.user_id, v_district)
     order by 3, p.full_name
     limit 100;
end;
$$;
revoke all on function public.parcel_remap_candidates(uuid) from public, anon;
grant execute on function public.parcel_remap_candidates(uuid) to authenticated;

create or replace function public.parcel_remap_assign(p_id uuid, p_surveyor uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_label text;
begin
  if not private.can_assign_remap() then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap_assign');
  end if;
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  if v.status = 'archived' or v.building_state = 'demolished' then
    perform private.raise_app_error('CONFLICT', 'remap_not_standing');
  end if;
  if v.parent_id is not null then
    perform private.raise_app_error('CONFLICT', 'remap_building');
  end if;
  if p_surveyor is null
     or not exists (select 1 from public.profiles p where p.user_id = p_surveyor and p.kind = 'staff' and p.status = 'active' and p.deleted_at is null)
     or not (private.user_has_permission(p_surveyor, 'surveys.create')
             and private.user_has_permission(p_surveyor, 'applications.capture_location')
             and private.user_can_access_district(p_surveyor, v.district_id)) then
    perform private.raise_app_error('VALIDATION', 'not_a_surveyor');
  end if;
  if length(coalesce(v_note, '')) > 400 then
    perform private.raise_app_error('VALIDATION', 'too_long');
  end if;

  update public.parcels
     set remap_status = 'assigned', remap_surveyor = p_surveyor, remap_requested_at = now(),
         remap_requested_by = auth.uid(), remap_note = v_note, remap_done_at = null
   where id = p_id;
  v_label := coalesce(v.pun, 'house ' || coalesce(v.house_no, '?'));
  perform private.parcel_event(p_id, 'remap_assigned', v_note, jsonb_build_object('surveyor', p_surveyor, 'previous', v.remap_surveyor));
  perform private.notify(p_surveyor, 'parcel.remap', 'Dib u sawir ' || v_label, 'Remap ' || v_label, '/surveys?status=remapping');
  return p_surveyor;
end;
$$;
revoke all on function public.parcel_remap_assign(uuid, uuid, text) from public, anon;
grant execute on function public.parcel_remap_assign(uuid, uuid, text) to authenticated;

create or replace function public.parcel_remap_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  if not private.can_assign_remap() then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap_assign');
  end if;
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.remap_status is distinct from 'assigned' then
    perform private.raise_app_error('CONFLICT', 'remap_not_assigned');
  end if;
  update public.parcels set remap_status = null, remap_surveyor = null, remap_requested_at = null,
                            remap_requested_by = null, remap_note = null
   where id = p_id;
  perform private.parcel_event(p_id, 'remap_cancelled', null, jsonb_build_object('surveyor', v.remap_surveyor));
end;
$$;
revoke all on function public.parcel_remap_cancel(uuid) from public, anon;
grant execute on function public.parcel_remap_cancel(uuid) to authenticated;

-- Remap: also the surveyor the remapping was given to; finishing it closes the job and tells whoever gave it.
create or replace function public.parcel_remap(p_id uuid, p_geom jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  g extensions.geometry;
  v_reason text := trim(coalesce(p_reason, ''));
  v_area numeric;
  v_moved numeric;
begin
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  -- Staff who capture locations and may change land in this district, or the surveyor the remapping or the site
  -- check was given to.
  if not public.has_permission('applications.capture_location')
     or not ((public.has_permission('parcels.update') and public.can_access_district(v.district_id))
             or (v.remap_status = 'assigned' and v.remap_surveyor = auth.uid() and public.has_permission('surveys.create'))
             or (v.site_check_surveyor = auth.uid() and public.has_permission('surveys.update'))) then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  if v.status = 'archived' or v.building_state = 'demolished' then
    perform private.raise_app_error('CONFLICT', 'remap_not_standing');
  end if;
  if v.parent_id is not null then
    perform private.raise_app_error('CONFLICT', 'remap_building');
  end if;
  if length(v_reason) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;

  begin
    g := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geom::text), 4326);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'child_invalid');
  end;
  if extensions.geometrytype(g) <> 'POLYGON' or not extensions.st_isvalid(g) or extensions.st_area(g::extensions.geography) < 10 then
    perform private.raise_app_error('VALIDATION', 'child_invalid');
  end if;
  if exists (select 1 from public.neighbourhoods n where n.id = v.neighbourhood_id and n.geom is not null
                and not extensions.st_intersects(n.geom, extensions.st_pointonsurface(g))) then
    perform private.raise_app_error('VALIDATION', 'outside_neighbourhood');
  end if;
  if exists (select 1 from public.parcels o
              where o.id <> v.id and o.deleted_at is null and o.status in ('registered', 'disputed')
                and not o.geom_provisional and o.parent_id is distinct from v.id
                and o.building_state is distinct from 'demolished'
                and extensions.st_intersects(o.geom, g)
                and extensions.st_area(extensions.st_intersection(o.geom, g)::extensions.geography) > 1) then
    perform private.raise_app_error('VALIDATION', 'still_overlapping');
  end if;

  v_area := round(extensions.st_area(g::extensions.geography)::numeric, 2);
  v_moved := round(extensions.st_distance(extensions.st_centroid(v.geom)::extensions.geography,
                                          extensions.st_centroid(g)::extensions.geography)::numeric);
  update public.parcels
     set geom = g,
         geom_provisional = false,
         perimeter_m = round(extensions.st_perimeter(g::extensions.geography)::numeric, 2),
         area_m2 = coalesce(area_m2, v_area),
         site_check_status = case when site_check_status = 'pending' then 'confirmed' else site_check_status end,
         site_check_done_at = case when site_check_status = 'pending' then now() else site_check_done_at end,
         site_check_done_by = case when site_check_status = 'pending' then auth.uid() else site_check_done_by end,
         site_check_note = case when site_check_status = 'pending' then left('Remapped: ' || v_reason, 500) else site_check_note end,
         remap_status = case when remap_status = 'assigned' then 'done' else remap_status end,
         remap_done_at = case when remap_status = 'assigned' then now() else remap_done_at end
   where id = v.id;
  update public.parcels set geom = g, geom_provisional = false where parent_id = v.id and deleted_at is null;

  perform private.parcel_event(v.id, 'remapped', v_reason, jsonb_build_object(
    'old_geom', extensions.st_asgeojson(v.geom)::jsonb, 'was_placed_by_guess', v.geom_provisional,
    'drawn_m2', v_area, 'recorded_m2', v.area_m2, 'moved_m', v_moved));
  if v.remap_status = 'assigned' and v.remap_requested_by is not null and v.remap_requested_by <> auth.uid() then
    perform private.notify(v.remap_requested_by, 'parcel.remapped',
      coalesce(v.pun, 'Dhulka') || ' dib ayaa loo sawiray', coalesce(v.pun, 'The land') || ' was remapped', '/parcels/' || v.id);
  end if;
  return jsonb_build_object('drawn_m2', v_area, 'recorded_m2', coalesce(v.area_m2, v_area), 'moved_m', v_moved);
end;
$$;
revoke all on function public.parcel_remap(uuid, jsonb, text) from public, anon;
grant execute on function public.parcel_remap(uuid, jsonb, text) to authenticated;

-- The surveyor given the remapping may see the land while the job is open.
alter policy parcels_select on public.parcels using (
  (select private.caller_is_active())
  and (((select public.has_permission('parcels.view'))
        and ((select private.viewer_sees_all_districts()) or district_id = any ((select private.viewer_district_ids())::uuid[]))
        and (status <> all (array['registered'::public.parcel_status, 'disputed'::public.parcel_status])
             or (select public.has_permission('parcels.registered'))))
       or site_check_surveyor = (select auth.uid())
       or (remap_status = 'assigned' and remap_surveyor = (select auth.uid()))
       or id in (select private.my_owned_parcel_ids())
       or (application_id is not null and private.can_view_application(application_id))
       or ((select public.has_permission('surveys.create'))
           and (created_by = (select auth.uid()) or neighbourhood_id in (select private.my_zone_neighbourhood_ids()))))
);
