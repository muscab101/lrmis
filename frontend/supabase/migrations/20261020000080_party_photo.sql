-- An owner's photo, for the ID card. Staff upload it on the owner's page or on the ID card's page; the server
-- puts the file in a private bucket and records its path here. The ID card shows the owner's current photo,
-- so a photo added after the card was issued still prints.

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('party-photos', 'party-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

/** Record an owner's new photo (already uploaded by the server). Returns the old path so the server can remove it. */
create or replace function public.party_set_photo(p_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parties;
begin
  if not (public.has_permission('owners.update') or public.has_permission('certificates.print') or public.has_permission('certificates.issue')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owners.update');
  end if;
  if p_path is null or p_path !~ ('^' || p_id::text || '/[0-9a-f-]{36}\.(jpeg|png|webp)$') then
    perform private.raise_app_error('VALIDATION', 'photo_path');
  end if;
  v := private.assert_party_in_scope(p_id);
  update public.parties set photo_path = p_path, updated_at = now() where id = p_id;
  return v.photo_path;
end;
$$;

/** Where an owner's photo is, for staff who can see owners or ID cards. */
create or replace function public.party_photo_path(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parties;
begin
  if not (public.has_permission('owners.view') or public.has_permission('certificates.view')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owners.view');
  end if;
  select * into v from public.parties where id = p_id and deleted_at is null;
  if v.id is null or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    return null;
  end if;
  return v.photo_path;
end;
$$;

revoke all on function public.party_set_photo(uuid, text), public.party_photo_path(uuid) from public, anon;
grant execute on function public.party_set_photo(uuid, text), public.party_photo_path(uuid) to authenticated;
