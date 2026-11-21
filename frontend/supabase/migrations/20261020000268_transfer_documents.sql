-- Transfers need supporting documents (sale agreement, ID copies, court papers… as PDF, Word, Excel or a photo).
-- A transfer cannot be submitted for approval until at least one document is attached.

create table public.transfer_documents (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references public.transfers (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null check (length(file_name) between 1 and 255),
  mime_type     text not null check (length(mime_type) between 1 and 150),
  size_bytes    int not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by   uuid references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now()
);
create index transfer_documents_transfer_idx on public.transfer_documents (transfer_id);
create index transfer_documents_uploaded_by_idx on public.transfer_documents (uploaded_by);

alter table public.transfer_documents enable row level security;
-- Whoever can see the transfer can see its documents.
create policy transfer_documents_select on public.transfer_documents for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id));
grant select on public.transfer_documents to authenticated;

/** Record a file already uploaded to storage. Only while the transfer is open (draft or waiting for approval). */
create or replace function public.transfer_document_add(p_transfer uuid, p_path text, p_name text, p_mime text, p_size int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
  v_id uuid;
begin
  perform private.assert_permission('transfers.create');
  select * into v from public.transfers where id = p_transfer;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status not in ('draft', 'submitted') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if p_path is null or p_path not like p_transfer::text || '/%' then
    perform private.raise_app_error('VALIDATION', 'document');
  end if;
  insert into public.transfer_documents (transfer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_transfer, p_path, left(coalesce(nullif(trim(p_name), ''), 'document'), 255), left(coalesce(nullif(p_mime, ''), 'application/octet-stream'), 150), p_size, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

/** Remove a document while the transfer is still a draft. Returns the storage path so the file can be deleted. */
create or replace function public.transfer_document_remove(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.transfer_documents;
  v public.transfers;
begin
  perform private.assert_permission('transfers.create');
  select * into v_doc from public.transfer_documents where id = p_id;
  select * into v from public.transfers where id = v_doc.transfer_id;
  if v_doc.id is null or v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  delete from public.transfer_documents where id = p_id;
  return v_doc.storage_path;
end;
$$;

revoke all on function public.transfer_document_add(uuid, text, text, text, int), public.transfer_document_remove(uuid) from public, anon;
grant execute on function public.transfer_document_add(uuid, text, text, text, int), public.transfer_document_remove(uuid) to authenticated;

-- Submitting needs at least one document.
do $do$
declare
  v text := pg_get_functiondef('public.transfer_submit(uuid)'::regprocedure);
  v_new text := replace(v, E'  perform private.assert_no_blockers(v.parcel_id, ''transfer'');',
    E'  if not exists (select 1 from public.transfer_documents d where d.transfer_id = p_id) then\n    perform private.raise_app_error(''VALIDATION'', ''documents_required'');\n  end if;\n  perform private.assert_no_blockers(v.parcel_id, ''transfer'');');
begin
  if v_new = v then
    raise exception 'transfer_submit: text not found';
  end if;
  execute v_new;
end;
$do$;

-- Private file store for the documents (the app signs short-lived download links).
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('transfer-documents', 'transfer-documents', false, 20971520)
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;
