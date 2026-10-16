-- ============================================================================
-- 0026 Citizen sign-in by SMS code without the Supabase phone provider.
-- LRMIS sends the code through its own SMS provider (Twilio now, a local gateway later).
-- Only a hash of the code is stored; codes expire after 5 minutes and allow 5 attempts.
-- The code never enters the messages outbox, so staff can't see it.
-- ============================================================================

create table public.citizen_otps (
  id           bigint generated always as identity primary key,
  phone        text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash    text not null,
  ip           text,
  attempts     int not null default 0,
  expires_at   timestamptz not null default now() + interval '5 minutes',
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index citizen_otps_phone_idx on public.citizen_otps (phone, created_at desc);
create index citizen_otps_ip_idx on public.citizen_otps (ip, created_at desc);
alter table public.citizen_otps enable row level security;

/** Store a new code hash. False when this phone (3 per 10 min) or IP (10 per hour) asked too often. */
create or replace function public.citizen_otp_store(p_phone text, p_hash text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.citizen_otps where phone = p_phone and created_at > now() - interval '10 minutes') >= 3
     or (p_ip is not null and (select count(*) from public.citizen_otps where ip = p_ip and created_at > now() - interval '1 hour') >= 10) then
    return false;
  end if;
  -- A new code replaces any earlier one.
  update public.citizen_otps set consumed_at = now() where phone = p_phone and consumed_at is null;
  insert into public.citizen_otps (phone, code_hash, ip) values (p_phone, p_hash, p_ip);
  return true;
end;
$$;

/** Check a code: the latest live code for the phone, at most 5 attempts. True consumes it. */
create or replace function public.citizen_otp_consume(p_phone text, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.citizen_otps;
begin
  select * into v from public.citizen_otps
   where phone = p_phone and consumed_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if v.id is null then
    return false;
  end if;
  if v.attempts >= 5 then
    update public.citizen_otps set consumed_at = now() where id = v.id;
    return false;
  end if;
  if v.code_hash <> p_hash then
    update public.citizen_otps set attempts = attempts + 1 where id = v.id;
    return false;
  end if;
  update public.citizen_otps set consumed_at = now(), attempts = attempts + 1 where id = v.id;
  return true;
end;
$$;

revoke execute on function public.citizen_otp_store(text, text, text), public.citizen_otp_consume(text, text) from public, anon, authenticated;
grant execute on function public.citizen_otp_store(text, text, text), public.citizen_otp_consume(text, text) to service_role;

-- First sign-in: link the citizen to the person already on the register with this phone (an
-- owner registered at the office), so they see their parcels. The SMS code proves the phone.
-- Only when exactly one unlinked person has that phone; otherwise a new record is made.
create or replace function public.my_party()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_profile public.profiles;
  v_email text;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select id into v_id from public.parties where citizen_user_id = auth.uid() and deleted_at is null;
  if v_id is not null then
    return v_id;
  end if;
  select * into v_profile from public.profiles where user_id = auth.uid();
  v_email := case when v_profile.email like '%@phone.lrmis.invalid' then null else v_profile.email end;
  if v_profile.phone is not null and v_profile.kind = 'citizen'
     and (select count(*) from public.parties where phone = v_profile.phone and citizen_user_id is null and deleted_at is null) = 1 then
    update public.parties set citizen_user_id = auth.uid(), phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now()
     where phone = v_profile.phone and citizen_user_id is null and deleted_at is null
    returning id into v_id;
    return v_id;
  end if;
  insert into public.parties (kind, full_name, phone, phone_verified_at, email, citizen_user_id, created_by)
  values ('person', coalesce(nullif(trim(v_profile.full_name), ''), 'Muwaadin'), v_profile.phone,
          case when v_profile.phone is not null then now() end, v_email, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prune-citizen-otps', '50 3 * * *', $c$delete from public.citizen_otps where created_at < now() - interval '2 days'$c$);
  end if;
end $$;
