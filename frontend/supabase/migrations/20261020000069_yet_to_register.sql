-- Yet to register: per neighbourhood, how much land is waiting (partial parcels, open applications)
-- and how much is registered, for the districts the caller can see. Feeds the "Yet to register" page:
-- neighbourhoods with land waiting, and neighbourhoods where nothing is registered yet.

create or replace function public.neighbourhood_registration_status(p_district uuid default null)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               has_boundary boolean, partial bigint, open_applications bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('parcels.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.view');
  end if;
  return query
    select n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, coalesce(n.has_geom, false),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.applications a
             where a.neighbourhood_id = n.id and a.status not in ('approved', 'rejected', 'cancelled')),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.neighbourhoods n
      join public.districts d on d.id = n.district_id
     where n.deleted_at is null and d.deleted_at is null
       and public.can_access_district(d.id) and (p_district is null or d.id = p_district)
     order by d.name_en, n.code;
end;
$$;

grant execute on function public.neighbourhood_registration_status(uuid) to authenticated;
revoke execute on function public.neighbourhood_registration_status(uuid) from public, anon;
