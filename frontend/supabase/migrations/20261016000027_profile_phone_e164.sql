-- ============================================================================
-- 0027 Supabase Auth stores phone numbers without the leading "+" (252…). The register
-- uses E.164 (+252…), so profiles must too, or citizens never match their owner record.
-- ============================================================================

create or replace function private.e164(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(p, '') is null then null
              when p ~ '^\+' then p
              when p ~ '^[1-9][0-9]{7,14}$' then '+' || p
              else p end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.user_kind :=
    case when new.raw_app_meta_data ->> 'kind' = 'staff' then 'staff' else 'citizen' end;
begin
  insert into public.profiles (user_id, kind, full_name, email, phone, status)
  values (
    new.id,
    v_kind,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    lower(new.email),
    private.e164(new.phone),
    case when v_kind = 'staff' then 'invited'::public.user_status else 'active'::public.user_status end
  );

  if v_kind = 'citizen' then
    insert into public.user_roles (user_id, role_id)
    select new.id, id from public.roles where key = 'citizen';
  end if;
  return new;
end;
$$;

create or replace function private.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    update public.profiles
       set email = lower(new.email), phone = coalesce(private.e164(new.phone), phone)
     where user_id = new.id;
  end if;
  return new;
end;
$$;

update public.profiles set phone = private.e164(phone) where phone ~ '^[1-9][0-9]{7,14}$';
