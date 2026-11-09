-- Screen copies of certificates and ID cards as video, for copy protection (DRM): on Safari, Edge and phones a
-- protected video shows black in screenshots and screen sharing. The website can't make video (it runs on Vercel), so
-- a separate DRM worker program does it: it takes a job here, opens the sheet through a one-time link, makes the
-- video and uploads it to a private storage bucket. Every certificate gets a job when it is issued and again when it
-- changes (reissue, cancel, expiry). Printing never uses these videos.

create table if not exists public.certificate_media (
  document_id uuid primary key references public.issued_documents (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'working', 'ready', 'failed')),
  -- What the video shows (the sheet's facts and status); a new one is made when this changes.
  source_hash text not null,
  made_hash text,
  storage_path text,
  -- The worker's one-time link to the sheet: only its hash is kept, and it ends after 15 minutes.
  token_hash text,
  token_expires timestamptz,
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create index if not exists certificate_media_queue_idx on public.certificate_media (status, updated_at);
alter table public.certificate_media enable row level security;
-- No one reads this table directly; the website's server (service role) and the functions below do.
revoke all on public.certificate_media from anon, authenticated;

-- The private bucket (only where storage exists: the test database has none).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('certificate-media', 'certificate-media', false)
    on conflict (id) do nothing;
  end if;
end;
$$;

create or replace function private.certificate_media_hash(d public.issued_documents)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(d.snapshot::text, '') || '|' || d.status::text || '|' || coalesce(d.expires_at::text, ''));
$$;

create or replace function private.certificate_media_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text := private.certificate_media_hash(new);
begin
  insert into public.certificate_media (document_id, source_hash)
  values (new.id, h)
  on conflict (document_id) do update
    set source_hash = excluded.source_hash,
        status = case when public.certificate_media.made_hash = excluded.source_hash then public.certificate_media.status else 'queued' end,
        attempts = case when public.certificate_media.made_hash = excluded.source_hash then public.certificate_media.attempts else 0 end,
        updated_at = now()
    where public.certificate_media.source_hash is distinct from excluded.source_hash;
  return new;
end;
$$;

drop trigger if exists certificate_media_queue on public.issued_documents;
create trigger certificate_media_queue after insert or update of snapshot, status, expires_at on public.issued_documents
  for each row execute function private.certificate_media_queue();

-- Every document there is now.
insert into public.certificate_media (document_id, source_hash)
select d.id, private.certificate_media_hash(d) from public.issued_documents d
on conflict (document_id) do nothing;

-- The worker takes the oldest waiting job (or one stuck for 15 minutes), with a one-time link to its sheet.
create or replace function public.certificate_media_claim(p_token_hash text)
returns table (document_id uuid, source_hash text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.certificate_media;
begin
  select * into v from public.certificate_media m
   where (m.status = 'queued' or (m.status = 'working' and m.token_expires < now()) or (m.status = 'failed' and m.attempts < 3 and m.updated_at < now() - interval '5 minutes'))
   order by m.updated_at
   limit 1
   for update skip locked;
  if v.document_id is null then
    return;
  end if;
  update public.certificate_media m
     set status = 'working', token_hash = p_token_hash, token_expires = now() + interval '15 minutes',
         attempts = m.attempts + 1, error = null, updated_at = now()
   where m.document_id = v.document_id;
  return query select v.document_id, v.source_hash;
end;
$$;

-- The sheet behind a one-time link, while its job is being worked on.
create or replace function public.certificate_media_job(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.document_id from public.certificate_media m
   where m.token_hash = p_token_hash and m.status = 'working' and m.token_expires > now();
$$;

-- The worker reports back: the video is uploaded (ready), or what went wrong (failed). The link stops working.
create or replace function public.certificate_media_done(p_token_hash text, p_ok boolean, p_path text, p_source_hash text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.certificate_media m
     set status = case when p_ok then (case when m.source_hash = p_source_hash then 'ready' else 'queued' end) else 'failed' end,
         storage_path = case when p_ok then p_path else m.storage_path end,
         made_hash = case when p_ok then p_source_hash else m.made_hash end,
         error = case when p_ok then null else left(p_error, 500) end,
         token_hash = null, token_expires = null, updated_at = now()
   where m.token_hash = p_token_hash;
end;
$$;

revoke all on function public.certificate_media_claim(text) from public, anon, authenticated;
revoke all on function public.certificate_media_job(text) from public, anon, authenticated;
revoke all on function public.certificate_media_done(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.certificate_media_claim(text) to service_role;
grant execute on function public.certificate_media_job(text) to service_role;
grant execute on function public.certificate_media_done(text, boolean, text, text, text) to service_role;
