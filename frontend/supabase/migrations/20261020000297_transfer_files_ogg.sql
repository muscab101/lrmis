-- Transfer files may also be .ogg (owner's request, 2026-11-28): WhatsApp voice notes and other Ogg recordings.
create or replace function private.transfer_file_ok(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$')) = any (array[
    'pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg']);
$$;
