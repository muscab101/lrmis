-- Signature and stamp: an admin uploads the official's signature (with their name and title) and the office stamp.
-- Every certificate shows them at the bottom when it is printed. Files are private; the app shows them by short-lived link.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('certificates.signature', 'certificates', 'signature', true, 'Set the signature and stamp on certificates',
        'Deji saxiixa iyo shaabadda shahaadooyinka', 365)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'certificates.signature' from public.roles r where r.key = 'admin'
on conflict do nothing;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['certificates.signature']) x)
 where key = 'admin';

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('certificate-marks', 'certificate-marks', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

/** One signature and one stamp for all certificates. */
create table public.certificate_marks (
  kind         text primary key check (kind in ('signature', 'stamp')),
  path         text check (path is null or path ~ '^(signature|stamp)/[0-9a-f-]{36}\.(png|jpeg|jpg|webp)$'),
  signer_name  text check (signer_name is null or length(trim(signer_name)) between 2 and 120),
  signer_title text check (signer_title is null or length(trim(signer_title)) between 2 and 120),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);
alter table public.certificate_marks enable row level security;
-- Read by the server when a certificate is drawn; changed only through certificate_marks_set.
create policy certificate_marks_select on public.certificate_marks for select to authenticated
  using (public.has_permission('certificates.view') or public.has_permission('certificates.signature'));
create trigger audit after insert or update or delete on public.certificate_marks for each row execute function private.audit_row();

/** Sets (or, with a null path, removes) the signature or stamp. Returns the file it replaces, so the old one can go. */
create or replace function public.certificate_marks_set(p_kind text, p_path text, p_name text default null, p_title text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform private.assert_permission('certificates.signature');
  if p_kind not in ('signature', 'stamp') then
    perform private.raise_app_error('VALIDATION', 'kind');
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_kind then
    perform private.raise_app_error('VALIDATION', 'file');
  end if;
  select path into v_old from public.certificate_marks where kind = p_kind;
  insert into public.certificate_marks (kind, path, signer_name, signer_title, updated_at, updated_by)
  values (p_kind, p_path, nullif(trim(p_name), ''), nullif(trim(p_title), ''), now(), auth.uid())
  on conflict (kind) do update
    set path = excluded.path, signer_name = excluded.signer_name, signer_title = excluded.signer_title,
        updated_at = now(), updated_by = auth.uid();
  return v_old;
end;
$$;
revoke all on function public.certificate_marks_set(text, text, text, text) from public, anon;
grant execute on function public.certificate_marks_set(text, text, text, text) to authenticated;

/** Changes only the signer's name and title (the signature image stays). */
create or replace function public.certificate_signer_set(p_name text, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.signature');
  insert into public.certificate_marks (kind, signer_name, signer_title, updated_at, updated_by)
  values ('signature', nullif(trim(p_name), ''), nullif(trim(p_title), ''), now(), auth.uid())
  on conflict (kind) do update
    set signer_name = excluded.signer_name, signer_title = excluded.signer_title, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.certificate_signer_set(text, text) from public, anon;
grant execute on function public.certificate_signer_set(text, text) to authenticated;
