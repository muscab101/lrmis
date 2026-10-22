-- ============================================================================
-- 0051 One House No per house in a neighbourhood.
--
-- Staff pick the House No from a list (01, 02, … 50) for the chosen
-- neighbourhood; numbers already given to other land there are left out.
-- An apartment block shares one House No between its flats, so a number used
-- by an apartment stays available for another flat of an apartment.
-- Open applications (not rejected / cancelled) and parcels both count.
-- ============================================================================

/** Whether a property type is a block of flats (same rule as the app: "apartment" or "flat" in its code or name). */
create function private.is_apartment_type(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is not null and (
    p_code ~* 'apartment|flat'
    or exists (select 1 from public.property_types t where t.code = p_code and t.name_en ~* 'apartment|flat'));
$$;
revoke all on function private.is_apartment_type(text) from public, anon, authenticated;

/** House numbers in use in a neighbourhood: by other open applications and by parcels (not this application's own). */
create function private.house_numbers_in_use(p_neighbourhood uuid, p_application uuid)
returns table (house_no text, apartment boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.house_no, bool_and(x.apartment)
  from (
    select a.house_no, private.is_apartment_type(a.property_type) as apartment
    from public.applications a
    where a.neighbourhood_id = p_neighbourhood and a.house_no is not null
      and a.status not in ('rejected', 'cancelled') and a.id is distinct from p_application
    union all
    select p.house_no, private.is_apartment_type(p.property_type)
    from public.parcels p
    where p.neighbourhood_id = p_neighbourhood and p.house_no is not null and p.deleted_at is null
      and p.application_id is distinct from p_application
      and (p_application is null
           or p.id is distinct from (select parcel_id from public.applications where id = p_application))
  ) x
  group by x.house_no;
$$;
revoke all on function private.house_numbers_in_use(uuid, uuid) from public, anon, authenticated;

/** For the House No list: the numbers taken in a neighbourhood (only the numbers, nothing about who has them). */
create function public.house_numbers_taken(p_neighbourhood uuid, p_application uuid default null)
returns table (house_no text, apartment boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise_app_error('PERMISSION_DENIED', 'sign in');
  end if;
  return query select * from private.house_numbers_in_use(p_neighbourhood, p_application);
end;
$$;
revoke all on function public.house_numbers_taken(uuid, uuid) from public, anon;
grant execute on function public.house_numbers_taken(uuid, uuid) to authenticated;

/** Staff set the office details on an application they can edit; the House No must be free in its neighbourhood. */
create or replace function public.application_set_details(
  p_id uuid, p_house_no text, p_govt_receipt_no text, p_property_type text default null, p_land_use text default null,
  p_flat_no text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house text := nullif(trim(p_house_no), '');
  v_type text := nullif(trim(p_property_type), '');
  v_nbhd uuid;
begin
  perform private.assert_can_edit_application(p_id);
  select neighbourhood_id into v_nbhd from public.applications where id = p_id;
  if v_house is not null and v_nbhd is not null and exists (
       select 1 from private.house_numbers_in_use(v_nbhd, p_id) u
       where u.house_no = v_house and not (u.apartment and private.is_apartment_type(v_type))) then
    perform private.raise_app_error('CONFLICT', 'house_no_taken');
  end if;
  update public.applications
     set house_no = v_house,
         flat_no = nullif(trim(p_flat_no), ''),
         govt_receipt_no = nullif(trim(p_govt_receipt_no), ''),
         property_type = v_type,
         land_use = nullif(trim(p_land_use), '')::public.land_use
   where id = p_id;
end;
$$;
