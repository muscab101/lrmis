-- Ownership transfers, part 2 (owner's request, 2026-11-27): review steps, document categories, an activity timeline,
-- the full transfer history with filters and counts, and every past owner linked to the transfer that ended them.
-- Nothing is ever deleted or overwritten: owners are closed with valid_to (as before), transfers are never deleted, and
-- files can only be removed from a draft.

-- 1. Review steps on a submitted transfer: under review, or waiting for more documents. Approving needs neither
--    (an approver may approve straight away) but is refused while more documents are awaited.
alter table public.transfers
  add column if not exists review_status text,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;
alter table public.transfers drop constraint if exists transfers_review_status_check;
alter table public.transfers add constraint transfers_review_status_check check (review_status is null or review_status in ('under_review', 'needs_documents'));

-- 2. Each file: what it is and a note.
alter table public.transfer_documents
  add column if not exists category text not null default 'other',
  add column if not exists description text;
alter table public.transfer_documents drop constraint if exists transfer_documents_category_check;
alter table public.transfer_documents add constraint transfer_documents_category_check check (category in (
  'ownership_certificate', 'sale_agreement', 'transfer_agreement', 'identification', 'court_order', 'inheritance',
  'witness', 'payment_receipt', 'other'));
alter table public.transfer_documents drop constraint if exists transfer_documents_description_check;
alter table public.transfer_documents add constraint transfer_documents_description_check check (description is null or length(description) <= 300);

-- 3. The reasons for a transfer (Valuation → Transfer types): the ones missing are added.
insert into public.transfer_types (name_so, name_en, works_as, duty, active, sort)
select x.so, x.en, x.kind::public.transfer_kind, x.duty, true, x.sort
  from (values ('Wareejin qoys', 'Family ownership transfer', 'gift', 0, 40),
               ('Amar maxkamadeed', 'Court order', 'court_order', 0, 50),
               ('Sixitaan maamul', 'Administrative correction', 'gift', 0, 60),
               ('Kale', 'Other', 'gift', 0, 90)) x(so, en, kind, duty, sort)
 where not exists (select 1 from public.transfer_types t where lower(t.name_en) = lower(x.en));

-- 4. Every past owner points to the transfer that ended (or started) their ownership.
alter table public.parcel_owners add column if not exists source_transfer_id uuid references public.transfers (id);
alter table public.parcel_owners add column if not exists ended_transfer_id uuid references public.transfers (id);

-- 5. The activity timeline of a transfer.
create table if not exists public.transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.transfers (id),
  kind text not null,
  note text,
  data jsonb not null default '{}',
  actor uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists transfer_events_transfer_idx on public.transfer_events (transfer_id, at);
alter table public.transfer_events enable row level security;
drop policy if exists transfer_events_select on public.transfer_events;
create policy transfer_events_select on public.transfer_events for select to authenticated
  using (public.has_permission('transfers.view')
         and exists (select 1 from public.transfers t where t.id = transfer_id and public.can_access_district(t.district_id)));
revoke insert, update, delete on public.transfer_events from anon, authenticated;

create or replace function private.transfer_event(p_transfer uuid, p_kind text, p_note text default null, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.transfer_events (transfer_id, kind, note, data, actor) values (p_transfer, p_kind, nullif(trim(p_note), ''), coalesce(p_data, '{}'), auth.uid());
$$;
revoke all on function private.transfer_event(uuid, text, text, jsonb) from public, anon, authenticated;

/** Writes the timeline from what happens to a transfer. */
create or replace function private.transfers_timeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.transfer_event(new.id, 'initiated', new.note, jsonb_build_object('kind', new.kind, 'type_id', new.type_id));
    perform private.transfer_event(new.id, 'previous_owner', null, jsonb_build_object('owners', new.from_owners));
    if jsonb_array_length(coalesce(new.to_owners, '[]')) > 0 then
      perform private.transfer_event(new.id, 'new_owner', null, jsonb_build_object('owners', new.to_owners));
    end if;
    return new;
  end if;
  if new.to_owners is distinct from old.to_owners and jsonb_array_length(coalesce(new.to_owners, '[]')) > 0 then
    perform private.transfer_event(new.id, 'new_owner', null, jsonb_build_object('owners', new.to_owners));
  end if;
  if new.review_status is distinct from old.review_status and new.review_status is not null and new.status = 'submitted' then
    perform private.transfer_event(new.id, new.review_status, new.review_note);
  end if;
  if new.status is distinct from old.status then
    perform private.transfer_event(new.id, new.status::text, case when new.status in ('approved', 'rejected', 'cancelled') then new.decision_note end);
    if new.status = 'approved' then
      perform private.transfer_event(new.id, 'ownership_updated', null, jsonb_build_object('owners', new.to_owners));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists transfers_timeline on public.transfers;
create trigger transfers_timeline after insert or update on public.transfers
  for each row execute function private.transfers_timeline();

/** Files on the timeline; a file added while more documents are awaited puts the transfer back under review. */
create or replace function private.transfer_documents_timeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.transfer_event(new.transfer_id, 'document', new.description,
      jsonb_build_object('file_name', new.file_name, 'category', new.category, 'size_bytes', new.size_bytes));
    update public.transfers set review_status = 'under_review', review_note = 'More documents added', reviewed_at = now()
     where id = new.transfer_id and status = 'submitted' and review_status = 'needs_documents';
    return new;
  end if;
  perform private.transfer_event(old.transfer_id, 'document_removed', null, jsonb_build_object('file_name', old.file_name));
  return old;
end;
$$;
drop trigger if exists transfer_documents_timeline on public.transfer_documents;
create trigger transfer_documents_timeline after insert or delete on public.transfer_documents
  for each row execute function private.transfer_documents_timeline();

revoke all on function private.transfers_timeline(), private.transfer_documents_timeline() from public, anon, authenticated;

-- 6. Only these files: documents (PDF, Word, JPG, PNG), video (MP4, MOV, WebM) and audio (MP3, WAV, M4A, AAC).
create or replace function private.transfer_file_ok(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$')) = any (array[
    'pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac']);
$$;

drop function if exists public.transfer_document_add(uuid, text, text, text, integer);
create or replace function public.transfer_document_add(p_transfer uuid, p_path text, p_name text, p_mime text, p_size integer,
                                                        p_category text default 'other', p_description text default null)
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
  if not private.transfer_file_ok(p_name) then
    perform private.raise_app_error('VALIDATION', 'document_type');
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > 50 * 1024 * 1024 then
    perform private.raise_app_error('VALIDATION', 'document_too_big');
  end if;
  insert into public.transfer_documents (transfer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, category, description)
  values (p_transfer, p_path, left(coalesce(nullif(trim(p_name), ''), 'document'), 255), left(coalesce(nullif(p_mime, ''), 'application/octet-stream'), 150),
          p_size, (select auth.uid()),
          case when p_category in ('ownership_certificate', 'sale_agreement', 'transfer_agreement', 'identification', 'court_order',
                                   'inheritance', 'witness', 'payment_receipt', 'other') then p_category else 'other' end,
          nullif(left(trim(coalesce(p_description, '')), 300), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.transfer_document_add(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.transfer_document_add(uuid, text, text, text, integer, text, text) to authenticated;

-- 7. Review: start it, or ask for more documents (with what is needed).
create or replace function public.transfer_review(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
begin
  perform private.assert_permission('transfers.approve');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if p_action = 'start' then
    update public.transfers set review_status = 'under_review', review_note = nullif(trim(coalesce(p_note, '')), ''),
                                reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  elsif p_action = 'request_documents' then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.transfers set review_status = 'needs_documents', review_note = trim(p_note),
                                reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    -- The person who made the transfer is told what is needed.
    if v.created_by is not null and v.created_by <> auth.uid() then
      perform private.notify(v.created_by, 'transfer.needs_documents', 'Wareejinta ' || v.number || ': dukumentiyo kale ayaa loo baahan yahay',
                             'Transfer ' || v.number || ': more documents needed', '/transfers/' || v.id);
    end if;
  else
    perform private.raise_app_error('VALIDATION', 'action');
  end if;
end;
$$;
revoke all on function public.transfer_review(uuid, text, text) from public, anon;
grant execute on function public.transfer_review(uuid, text, text) to authenticated;

-- 8. Approving: refused while more documents are awaited; the old owners point to this transfer, the new ones too.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.transfer_decide(uuid, boolean, text)'::regprocedure);
  n := replace(d, $a$  if v.duty_invoice_id is not null and exists (select 1 from public.invoices where id = v.duty_invoice_id and status <> 'paid') then$a$,
                  $b$  if v.review_status = 'needs_documents' then
    perform private.raise_app_error('CONFLICT', 'needs_documents');
  end if;
  if v.duty_invoice_id is not null and exists (select 1 from public.invoices where id = v.duty_invoice_id and status <> 'paid') then$b$);
  n := replace(n, $a$  update public.parcel_owners set valid_to = current_date where parcel_id = v.parcel_id and valid_to is null;$a$,
                  $b$  update public.parcel_owners set valid_to = current_date, ended_transfer_id = p_id where parcel_id = v.parcel_id and valid_to is null;$b$);
  n := replace(n, $a$    insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
    values (v.parcel_id, (r ->> 'party_id')::uuid, (r ->> 'role')::public.application_party_role, (r ->> 'share_pct')::numeric, null);$a$,
                  $b$    insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id, source_transfer_id)
    values (v.parcel_id, (r ->> 'party_id')::uuid, (r ->> 'role')::public.application_party_role, (r ->> 'share_pct')::numeric, null, p_id);$b$);
  if position('ended_transfer_id' in n) = 0 or position('source_transfer_id' in n) = 0 or position('needs_documents' in n) = 0 then
    raise exception 'transfer_decide: anchor not found';
  end if;
  execute n;
end;
$do$;

-- 9. The history: every transfer the user may see, with filters, and the counts for the cards.
create or replace function public.transfer_history(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce((p ->> 'size')::int, 25), 1), 500);
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_rows jsonb;
  v_total int;
  v_stats jsonb;
begin
  perform private.assert_permission('transfers.view');
  with base as (
    select t.*,
           case when t.status = 'submitted' and t.review_status is not null then t.review_status else t.status::text end as state,
           coalesce(t.decided_at, t.submitted_at, t.created_at) as on_date,
           pc.pun, pc.house_no, pc.neighbourhood_id,
           d.name_so as district_so, d.name_en as district_en,
           nb.name_so as nb_so, nb.name_en as nb_en, nb.code as nb_code,
           tt.name_so as type_so, tt.name_en as type_en,
           (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(t.from_owners) o) as from_names,
           (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(t.to_owners) o) as to_names,
           (select count(*) from public.transfer_documents dd where dd.transfer_id = t.id)::int as files
      from public.transfers t
      left join public.parcels pc on pc.id = t.parcel_id
      left join public.districts d on d.id = t.district_id
      left join public.neighbourhoods nb on nb.id = pc.neighbourhood_id
      left join public.transfer_types tt on tt.id = t.type_id
     where public.can_access_district(t.district_id)
  ),
  f as (
    select * from base b
     where (p ->> 'id' is null or b.id = (p ->> 'id')::uuid)
       and (v_q is null or b.number ilike '%' || v_q || '%' or b.pun ilike '%' || v_q || '%' or b.house_no ilike v_q
            or b.from_names ilike '%' || v_q || '%' or b.to_names ilike '%' || v_q || '%')
       and (p ->> 'district' is null or b.district_id = (p ->> 'district')::uuid)
       and (p ->> 'neighbourhood' is null or b.neighbourhood_id = (p ->> 'neighbourhood')::uuid)
       and (p ->> 'type' is null or b.type_id = (p ->> 'type')::uuid)
       and (p ->> 'state' is null or b.state = p ->> 'state'
            or (p ->> 'state' = 'pending' and b.status = 'submitted'))
       and (p ->> 'from' is null or b.on_date >= (p ->> 'from')::date)
       and (p ->> 'to' is null or b.on_date < (p ->> 'to')::date + 1)
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
           'id', x.id, 'number', x.number, 'parcel_id', x.parcel_id, 'pun', x.pun, 'house_no', x.house_no, 'nb_code', x.nb_code,
           'district_so', x.district_so, 'district_en', x.district_en, 'nb_so', x.nb_so, 'nb_en', x.nb_en,
           'from_names', x.from_names, 'to_names', x.to_names, 'kind', x.kind, 'type_so', x.type_so, 'type_en', x.type_en,
           'on_date', x.on_date, 'files', x.files, 'state', x.state) order by x.on_date desc)
           from (select * from f order by f.on_date desc offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
         (select jsonb_build_object(
            'total', count(*),
            'pending', count(*) filter (where b.status = 'submitted'),
            'approved', count(*) filter (where b.status = 'approved'),
            'rejected', count(*) filter (where b.status = 'rejected'),
            'this_month', count(*) filter (where b.created_at >= date_trunc('month', now())))
            from base b)
    into v_total, v_rows, v_stats;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'stats', v_stats);
end;
$$;
revoke all on function public.transfer_history(jsonb) from public, anon;
grant execute on function public.transfer_history(jsonb) to authenticated;

-- 10. A parcel's owners, past and present, each with the transfer that started and ended their ownership.
create or replace function public.parcel_ownership_history(p_parcel uuid)
returns table (party_id uuid, full_name text, role text, share_pct numeric, valid_from date, valid_to date, current boolean,
               source_transfer_id uuid, source_number text, ended_transfer_id uuid, ended_number text, ended_kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.parcels where id = p_parcel and public.can_access_district(district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return query
  select po.party_id, pa.full_name, po.role::text, po.share_pct, po.valid_from, po.valid_to, po.valid_to is null,
         po.source_transfer_id, st.number, po.ended_transfer_id, et.number, et.kind::text
    from public.parcel_owners po
    join public.parties pa on pa.id = po.party_id
    left join public.transfers st on st.id = po.source_transfer_id
    left join public.transfers et on et.id = po.ended_transfer_id
   where po.parcel_id = p_parcel
   order by po.valid_to is null desc, coalesce(po.valid_from, po.created_at::date) desc, pa.full_name;
end;
$$;
revoke all on function public.parcel_ownership_history(uuid) from public, anon;
grant execute on function public.parcel_ownership_history(uuid) to authenticated;
