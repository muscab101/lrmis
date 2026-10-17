-- ============================================================================
-- 0032 Duplicate check while entering a location: other parcels and open applications
-- within a few metres of a point. Staff see numbers in their districts; citizens only a count.
-- ============================================================================

create or replace function public.pin_nearby(p_lon float8, p_lat float8, p_exclude uuid default null, p_metres numeric default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_pt geography := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;
  v_staff boolean := private.caller_is_staff();
  v_r numeric := least(greatest(coalesce(p_metres, 10), 1), 50);
  v_parcels jsonb;
  v_apps jsonb;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('pun', p.pun, 'metres', round(st_distance(p.geom::geography, v_pt)::numeric, 1))), '[]'::jsonb) into v_parcels
    from public.parcels p
   where p.deleted_at is null and p.status <> 'archived' and st_dwithin(p.geom::geography, v_pt, v_r)
     and (not v_staff or public.can_access_district(p.district_id));
  select coalesce(jsonb_agg(jsonb_build_object('number', a.number, 'metres', round(st_distance(a.pin::geography, v_pt)::numeric, 1))), '[]'::jsonb) into v_apps
    from public.applications a
   where a.pin is not null and a.id is distinct from p_exclude and a.status not in ('rejected', 'cancelled', 'approved')
     and st_dwithin(a.pin::geography, v_pt, v_r)
     and (not v_staff or public.can_access_district(a.district_id));
  if not v_staff then
    return jsonb_build_object('count', jsonb_array_length(v_parcels) + jsonb_array_length(v_apps));
  end if;
  return jsonb_build_object('count', jsonb_array_length(v_parcels) + jsonb_array_length(v_apps), 'parcels', v_parcels, 'applications', v_apps);
end;
$$;
grant execute on function public.pin_nearby(float8, float8, uuid, numeric) to authenticated;
revoke execute on function public.pin_nearby(float8, float8, uuid, numeric) from public, anon;
