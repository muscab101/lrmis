-- Transfer documents may also be videos and audio (and any ordinary file), up to 50 MB.
-- Files now go straight from the browser to storage through a one-time upload link; this check runs first.

alter table public.transfer_documents drop constraint if exists transfer_documents_size_bytes_check;
alter table public.transfer_documents add constraint transfer_documents_size_bytes_check check (size_bytes > 0 and size_bytes <= 52428800);

/** May the caller attach a document to this transfer right now? Raises the same errors as transfer_document_add. */
create or replace function public.transfer_document_check(p_transfer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
begin
  perform private.assert_permission('transfers.create');
  select * into v from public.transfers where id = p_transfer;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status not in ('draft', 'submitted') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
end;
$$;

revoke all on function public.transfer_document_check(uuid) from public, anon;
grant execute on function public.transfer_document_check(uuid) to authenticated;

do $$
begin
  update storage.buckets set file_size_limit = 52428800 where id = 'transfer-documents';
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;
