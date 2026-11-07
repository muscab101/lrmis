-- Everyone can put a photo on their own profile: shown in the header. Files are private; the app shows them by short-lived link.
alter table public.profiles add column avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpeg|jpg|png|webp)$');

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('profile-photos', 'profile-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

/** Sets (or, with null, removes) the signed-in person's own photo. Returns the photo it replaces, so the old file can go. */
create function public.profile_set_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    perform private.raise_app_error('VALIDATION', 'file');
  end if;
  select avatar_path into v_old from public.profiles where user_id = auth.uid();
  update public.profiles set avatar_path = p_path where user_id = auth.uid();
  return v_old;
end;
$$;
revoke all on function public.profile_set_avatar(text) from public, anon;
grant execute on function public.profile_set_avatar(text) to authenticated;
