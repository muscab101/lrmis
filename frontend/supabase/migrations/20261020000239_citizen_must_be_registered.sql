-- Only people already on the land register can sign in to the citizen portal. A phone that isn't on the register is
-- told to register first at an LRMIS office; no empty "Muwaadin" owner record is made for it any more.

/** The phone belongs to someone on the register (an owner or person recorded by staff). Used before a code is sent. */
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
       and (p.citizen_user_id is null or p.created_by is distinct from p.citizen_user_id));
$$;
revoke all on function public.citizen_phone_registered(text) from public, anon, authenticated;
grant execute on function public.citizen_phone_registered(text) to service_role;

-- my_party links the signed-in citizen to their record on the register, and no longer makes one (null: not on it).
create or replace function public.my_party()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select id into v_id from public.parties where citizen_user_id = auth.uid() and deleted_at is null;
  if v_id is not null then
    return v_id;
  end if;
  select * into v_profile from public.profiles where user_id = auth.uid();
  if v_profile.phone is not null and v_profile.kind = 'citizen'
     and (select count(*) from public.parties where phone = v_profile.phone and citizen_user_id is null and deleted_at is null) = 1 then
    update public.parties set citizen_user_id = auth.uid(), phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now()
     where phone = v_profile.phone and citizen_user_id is null and deleted_at is null
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
