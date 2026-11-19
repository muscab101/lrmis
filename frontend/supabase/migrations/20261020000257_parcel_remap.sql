-- Remap: put land that is already in the system where it really is on the map.
-- Meant above all for land placed on the map by guess (the old LRMIS plots sit on a small square near their sector's
-- point, marked "location to check"), but it works for any standing plot whose drawing is wrong.
-- Only the drawing changes: the recorded size (width, length, m²) and the bills stay as they are; a change of size
-- is still a Correct boundary request with its approval. A remap clears "location to check", ticks an open site
-- check as confirmed, and keeps the old place in the land's history.

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
  -- Staff who capture locations and may change land in this district, or the surveyor the site check was given to.
  if not public.has_permission('applications.capture_location')
     or not ((public.has_permission('parcels.update') and public.can_access_district(v.district_id))
             or (v.site_check_surveyor = auth.uid() and public.has_permission('surveys.update'))) then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  if v.status = 'archived' or v.building_state = 'demolished' then
    perform private.raise_app_error('CONFLICT', 'remap_not_standing');
  end if;
  -- A flat or a compound house is drawn with its building: remap the building.
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
  -- Land drawn for real may not overlap (placed-by-guess squares don't count; nor do this land's own flats).
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
         site_check_note = case when site_check_status = 'pending' then left('Remapped: ' || v_reason, 500) else site_check_note end
   where id = v.id;
  -- The flats of a building stand where the building stands.
  update public.parcels set geom = g, geom_provisional = false where parent_id = v.id and deleted_at is null;

  perform private.parcel_event(v.id, 'remapped', v_reason, jsonb_build_object(
    'old_geom', extensions.st_asgeojson(v.geom)::jsonb, 'was_placed_by_guess', v.geom_provisional,
    'drawn_m2', v_area, 'recorded_m2', v.area_m2, 'moved_m', v_moved));
  return jsonb_build_object('drawn_m2', v_area, 'recorded_m2', coalesce(v.area_m2, v_area), 'moved_m', v_moved);
end;
$$;
revoke all on function public.parcel_remap(uuid, jsonb, text) from public, anon;
grant execute on function public.parcel_remap(uuid, jsonb, text) to authenticated;
