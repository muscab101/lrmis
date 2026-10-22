-- A zone's count is every house in its neighbourhood (any stage but archived) against the target
-- (the neighbourhood's capacity): adding one house there moves it from 0/50 to 1/50.

create or replace function public.survey_zone_list(p_mine boolean default false, p_status text default 'open')
returns table (id uuid, neighbourhood_id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               surveyor_id uuid, surveyor text, target int, note text, status text, assigned_at timestamptz, assigned_by text,
               recorded bigint, partial bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('surveys.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.view');
  end if;
  return query
    select z.id, n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, z.surveyor_id, sp.full_name, z.target, z.note, z.status,
           z.assigned_at, ap.full_name,
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.status <> 'archived'),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.survey_zones z
      join public.neighbourhoods n on n.id = z.neighbourhood_id
      join public.districts d on d.id = z.district_id
      left join public.profiles sp on sp.user_id = z.surveyor_id
      left join public.profiles ap on ap.user_id = z.assigned_by
     where (z.surveyor_id = auth.uid() or (not coalesce(p_mine, false) and public.can_access_district(z.district_id)))
       and (coalesce(p_status, 'any') = 'any' or z.status = p_status)
     order by z.status = 'open' desc, z.assigned_at desc
     limit 500;
end;
$$;
