-- The citizen portal is for land owners: a phone signs in only when it belongs to someone on the register who holds
-- land there (an owner, or a building's manager). A person on the register with no land is told to register first.

create or replace function public.citizen_phone_registered(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.parties p
     where p.phone = p_phone and p.deleted_at is null
       -- A record the citizen made for themselves on an earlier sign-in doesn't count.
       and (p.citizen_user_id is null or p.created_by is distinct from p.citizen_user_id)
       and exists (select 1 from public.parcel_owners po join public.parcels pc on pc.id = po.parcel_id
                    where po.party_id = p.id and po.valid_to is null and pc.deleted_at is null));
$$;
revoke all on function public.citizen_phone_registered(text) from public, anon, authenticated;
grant execute on function public.citizen_phone_registered(text) to service_role;
