-- Owners waiting for their land in a survey zone. A surveyor can add an owner from the zone and stop before adding
-- the land; the owner is saved with no land and was hard to find again. The zone page now lists them with "Add land"
-- so the work carries on. They are owners added (since the zone was assigned, in its district) by the zone's surveyor or
-- by whoever is looking, who have no land and no application yet.

create or replace function public.zone_owners_waiting(p_zone uuid)
returns table (party_id uuid, full_name text, phone text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  z public.survey_zones;
begin
  perform private.assert_permission('surveys.view');
  select * into z from public.survey_zones where id = p_zone;
  if z.id is null or not public.can_access_district(z.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'zone');
  end if;
  return query
  select pa.id, pa.full_name, pa.phone, pa.created_at
    from public.parties pa
   where pa.deleted_at is null
     and pa.created_by in (z.surveyor_id, auth.uid())
     and pa.created_at >= z.assigned_at
     and (pa.district_id is null or pa.district_id = z.district_id)
     and not exists (select 1 from public.parcel_owners po where po.party_id = pa.id)
     and not exists (select 1 from public.application_parties ap where ap.party_id = pa.id)
   order by pa.created_at desc
   limit 50;
end;
$$;
revoke all on function public.zone_owners_waiting(uuid) from public, anon;
grant execute on function public.zone_owners_waiting(uuid) to authenticated;
