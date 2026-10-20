-- ============================================================================
-- 0049 Delete a location (district, section, sector, neighbourhood, street,
-- facility) that nothing uses. Anything still pointing at it — a child
-- location, parcel, application, owner, survey, invoice — makes the database
-- refuse, and the caller is told to archive it instead. Needs locations.delete
-- (Admin, Super Admin); the audit log keeps the deleted row.
-- ============================================================================

create function public.location_delete(p_level text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid;
begin
  perform private.assert_permission('locations.delete');
  if p_level not in ('districts', 'sections', 'sectors', 'neighbourhoods', 'streets', 'facilities') then
    perform private.raise_app_error('VALIDATION', 'level');
  end if;
  execute format('select %s from public.%I where id = $1', case when p_level = 'districts' then 'id' else 'district_id' end, p_level)
    into v_district using p_id;
  if v_district is null then
    perform private.raise_app_error('NOT_FOUND', 'location');
  end if;
  if not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  begin
    execute format('delete from public.%I where id = $1', p_level) using p_id;
  exception when foreign_key_violation then
    perform private.raise_app_error('HAS_RECORDS', 'location_in_use');
  end;
end;
$$;
revoke all on function public.location_delete(text, uuid) from public, anon;
grant execute on function public.location_delete(text, uuid) to authenticated;
