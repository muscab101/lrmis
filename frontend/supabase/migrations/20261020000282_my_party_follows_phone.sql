-- The portal follows an owner's new phone (owner's report, 2026-11-23): an owner signed up to the portal with a wrong
-- number, staff then corrected the number on the register, and signing in with the right number showed nothing,
-- because the owner was still linked to the first account. Now an account whose phone is an owner's phone takes that
-- owner over when the account linked to it has a different phone (a stale link). Owners already linked to an account
-- with their own phone are never taken over.

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
  if v_profile.phone is null or v_profile.kind <> 'citizen' then
    return null;
  end if;
  -- The one owner with this phone, not linked yet or linked to an account with another phone.
  if (select count(*) from public.parties pa
       where pa.phone = v_profile.phone and pa.deleted_at is null
         and (pa.citizen_user_id is null
              or not exists (select 1 from public.profiles o where o.user_id = pa.citizen_user_id and o.phone = pa.phone))) = 1 then
    update public.parties pa set citizen_user_id = auth.uid(), phone_verified_at = coalesce(pa.phone_verified_at, now()), updated_at = now()
     where pa.phone = v_profile.phone and pa.deleted_at is null
       and (pa.citizen_user_id is null
            or not exists (select 1 from public.profiles o where o.user_id = pa.citizen_user_id and o.phone = pa.phone))
    returning pa.id into v_id;
  end if;
  return v_id;
end;
$$;
