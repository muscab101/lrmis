-- Remapping work by neighbourhood and surveyor, for its own table next to the survey zones (Yet to register → Zones →
-- Remapping): how many plots each surveyor was given there, how many are remapped, when and by whom it was given.
-- Staff who give out remapping see their districts; everyone else (and "mine") sees only their own work.

create or replace function public.remap_zone_list(p_mine boolean default false, p_with_done boolean default false)
returns table(neighbourhood_id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
              surveyor_id uuid, surveyor text, total bigint, done bigint, guessed bigint, assigned_at timestamptz,
              last_at timestamptz, assigned_by text, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := not coalesce(p_mine, false) and private.can_assign_remap();
begin
  if not private.caller_is_active() then
    perform private.raise_app_error('PERMISSION_DENIED', 'remap_list');
  end if;
  return query
    with jobs as (
      select p.neighbourhood_id, p.remap_surveyor, p.remap_status, p.geom_provisional, p.remap_requested_at,
             p.remap_requested_by, p.remap_note, p.district_id
        from public.parcels p
       where p.deleted_at is null and p.remap_status in ('assigned', 'done') and p.remap_surveyor is not null
         and p.neighbourhood_id is not null
         and (case when v_all then public.can_access_district(p.district_id) else p.remap_surveyor = auth.uid() end)
    ), grouped as (
      select j.neighbourhood_id, j.remap_surveyor, min(j.district_id::text)::uuid as district_id,
             count(*) as total, count(*) filter (where j.remap_status = 'done') as done,
             count(*) filter (where j.remap_status = 'assigned' and j.geom_provisional) as guessed,
             min(j.remap_requested_at) as assigned_at, max(j.remap_requested_at) as last_at,
             (array_agg(j.remap_requested_by order by j.remap_requested_at desc))[1] as by_id,
             (array_agg(j.remap_note order by j.remap_requested_at desc) filter (where j.remap_note is not null))[1] as note
        from jobs j
       group by 1, 2
    )
    select g.neighbourhood_id, n.code, n.name_so, n.name_en, g.district_id, d.name_so, d.name_en,
           g.remap_surveyor, sp.full_name, g.total, g.done, g.guessed, g.assigned_at, g.last_at, bp.full_name, g.note
      from grouped g
      join public.neighbourhoods n on n.id = g.neighbourhood_id
      join public.districts d on d.id = g.district_id
      left join public.profiles sp on sp.user_id = g.remap_surveyor
      left join public.profiles bp on bp.user_id = g.by_id
     where coalesce(p_with_done, false) or g.done < g.total
     order by (g.done < g.total) desc, g.last_at desc
     limit 500;
end;
$$;
revoke all on function public.remap_zone_list(boolean, boolean) from public, anon;
grant execute on function public.remap_zone_list(boolean, boolean) to authenticated;
