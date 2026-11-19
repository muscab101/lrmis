-- Remapping for a whole neighbourhood (Yet to register → assign): every plot of the neighbourhood that can be
-- remapped (standing, not a flat, not locked or archived) is given to one surveyor in one go, or only the plots that
-- were placed on the map by guess. Plots already with a surveyor for remapping are left as they are. The surveyor gets
-- one notice for the lot.

-- What a neighbourhood has to remap: all remappable plots, those placed by guess, and those already given out.
create or replace function public.neighbourhood_remap_summary(p_neighbourhood uuid)
returns table(total bigint, guessed bigint, assigned bigint)
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
  select s.district_id into v_district
    from public.neighbourhoods n join public.sectors k on k.id = n.sector_id join public.sections s on s.id = k.section_id
   where n.id = p_neighbourhood;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  return query
    select count(*) filter (where p.remap_status is distinct from 'assigned'),
           count(*) filter (where p.remap_status is distinct from 'assigned' and p.geom_provisional),
           count(*) filter (where p.remap_status = 'assigned')
      from public.parcels p
     where p.neighbourhood_id = p_neighbourhood and p.deleted_at is null and p.parent_id is null
       and p.locked_at is null and p.status <> 'archived' and p.building_state is distinct from 'demolished'
       and p.geom is not null;
end;
$$;
revoke all on function public.neighbourhood_remap_summary(uuid) from public, anon;
grant execute on function public.neighbourhood_remap_summary(uuid) to authenticated;

create or replace function public.neighbourhood_remap_assign(p_neighbourhood uuid, p_surveyor uuid, p_note text default null,
                                                            p_only_guessed boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid;
  v_name text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_ids uuid[];
  v_id uuid;
begin
  if not private.can_assign_remap() then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap_assign');
  end if;
  select s.district_id, n.name_so into v_district, v_name
    from public.neighbourhoods n join public.sectors k on k.id = n.sector_id join public.sections s on s.id = k.section_id
   where n.id = p_neighbourhood;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  if p_surveyor is null
     or not exists (select 1 from public.profiles p where p.user_id = p_surveyor and p.kind = 'staff' and p.status = 'active' and p.deleted_at is null)
     or not (private.user_has_permission(p_surveyor, 'surveys.create')
             and private.user_has_permission(p_surveyor, 'applications.capture_location')
             and private.user_can_access_district(p_surveyor, v_district)) then
    perform private.raise_app_error('VALIDATION', 'not_a_surveyor');
  end if;
  if length(coalesce(v_note, '')) > 400 then
    perform private.raise_app_error('VALIDATION', 'too_long');
  end if;

  with picked as (
    select p.id from public.parcels p
     where p.neighbourhood_id = p_neighbourhood and p.deleted_at is null and p.parent_id is null
       and p.locked_at is null and p.status <> 'archived' and p.building_state is distinct from 'demolished'
       and p.geom is not null and p.remap_status is distinct from 'assigned'
       and (not p_only_guessed or p.geom_provisional)
     for update
  ), done as (
    update public.parcels x
       set remap_status = 'assigned', remap_surveyor = p_surveyor, remap_requested_at = now(),
           remap_requested_by = auth.uid(), remap_note = v_note, remap_done_at = null
      from picked where x.id = picked.id
    returning x.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from done;
  if cardinality(v_ids) = 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_to_remap');
  end if;
  foreach v_id in array v_ids loop
    perform private.parcel_event(v_id, 'remap_assigned', v_note, jsonb_build_object('surveyor', p_surveyor, 'neighbourhood', p_neighbourhood));
  end loop;
  perform private.notify(p_surveyor, 'parcel.remap',
    cardinality(v_ids) || ' dhul oo ' || coalesce(v_name, '') || ' ah dib u sawir',
    'Remap ' || cardinality(v_ids) || ' plots in ' || coalesce(v_name, 'a neighbourhood'),
    '/surveys?status=remapping');
  return cardinality(v_ids);
end;
$$;
revoke all on function public.neighbourhood_remap_assign(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.neighbourhood_remap_assign(uuid, uuid, text, boolean) to authenticated;
