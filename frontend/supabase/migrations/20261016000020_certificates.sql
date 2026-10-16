-- ============================================================================
-- 0020 Phase 8 — Title certificates, property ID cards, print log, reprints and public
-- verification (§4.9).
--   Eligible: parcel registered, not disputed, no upheld/open objection, and (by default)
--   nothing left to pay (setting certificates.require_full_payment).
--   One valid certificate per parcel; one valid ID card per parcel owner.
--   The first print is logged; any later print is a reprint: reason + fee invoice (paid) +
--   approval by someone else → a new document with a new serial, the old one cancelled.
-- ============================================================================

create type public.document_type as enum ('certificate', 'id_card');
create type public.issued_document_status as enum ('valid', 'cancelled');

insert into public.settings (key, value, description) values
  ('certificates.require_full_payment', 'true', 'Certificates need every invoice of the parcel paid (otherwise only nothing overdue)'),
  ('certificates.id_card_years', '5', 'How many years a property ID card is valid'),
  ('certificates.reprint_requires_fee', 'true', 'Reprints need the certificate fee invoice paid before approval')
on conflict (key) do nothing;

create table public.issued_documents (
  id             uuid primary key default gen_random_uuid(),
  type           public.document_type not null,
  serial         text not null unique,
  verify_code    text not null unique,
  parcel_id      uuid not null references public.parcels (id),
  party_id       uuid references public.parties (id),
  district_id    uuid not null references public.districts (id),
  status         public.issued_document_status not null default 'valid',
  snapshot       jsonb not null,
  issued_at      timestamptz not null default now(),
  issued_by      uuid references auth.users (id) on delete set null,
  expires_at     date,
  print_count    int not null default 0,
  replaces_id    uuid references public.issued_documents (id),
  cancelled_at   timestamptz,
  cancelled_by   uuid references auth.users (id) on delete set null,
  cancel_reason  text,
  check ((type = 'id_card') = (party_id is not null))
);
create unique index issued_documents_cert_uidx on public.issued_documents (parcel_id) where type = 'certificate' and status = 'valid';
create unique index issued_documents_card_uidx on public.issued_documents (parcel_id, party_id) where type = 'id_card' and status = 'valid';
create index issued_documents_parcel_idx on public.issued_documents (parcel_id);

create table public.print_jobs (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.issued_documents (id),
  kind         text not null check (kind in ('original', 'reprint')),
  printed_by   uuid references auth.users (id) on delete set null,
  printed_at   timestamptz not null default now()
);
create index print_jobs_document_idx on public.print_jobs (document_id);

create table public.reprint_requests (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.issued_documents (id),
  reason          text not null check (length(trim(reason)) >= 5),
  fee_invoice_id  uuid references public.invoices (id),
  status          public.decision_status not null default 'pending',
  requested_by    uuid references auth.users (id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  new_document_id uuid references public.issued_documents (id)
);
create unique index reprint_requests_pending_uidx on public.reprint_requests (document_id) where status = 'pending';

create trigger audit after insert or update or delete on public.issued_documents for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.print_jobs for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.reprint_requests for each row execute function private.audit_row();

alter table public.issued_documents enable row level security;
alter table public.print_jobs enable row level security;
alter table public.reprint_requests enable row level security;
revoke all on public.issued_documents, public.print_jobs, public.reprint_requests from anon;
revoke insert, update, delete on public.issued_documents, public.print_jobs, public.reprint_requests from authenticated;

create or replace function private.can_view_document(p_district uuid, p_parcel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.has_permission('certificates.view') and public.can_access_district(p_district)) or private.is_parcel_owner(p_parcel);
$$;

create policy issued_documents_select on public.issued_documents for select to authenticated using (private.can_view_document(district_id, parcel_id));
create policy print_jobs_select on public.print_jobs for select to authenticated
  using (exists (select 1 from public.issued_documents d where d.id = document_id and public.has_permission('certificates.view') and public.can_access_district(d.district_id)));
create policy reprint_requests_select on public.reprint_requests for select to authenticated
  using (exists (select 1 from public.issued_documents d where d.id = document_id and public.has_permission('certificates.view') and public.can_access_district(d.district_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** 12-character code without look-alike letters, for the QR / verify URL. */
create or replace function private.new_verify_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v text := '';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
begin
  for i in 0..11 loop
    v := v || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v;
end;
$$;

/** Why a parcel can't get a certificate right now (empty array = eligible). */
create or replace function private.certificate_blockers(p_parcel uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_out text[] := '{}';
begin
  select * into v from public.parcels where id = p_parcel;
  if v.status <> 'registered' then
    v_out := array_append(v_out, case when v.status = 'disputed' then 'disputed' else 'not_registered' end);
  end if;
  if exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id
             where n.parcel_id = p_parcel and o.status in ('open', 'upheld')) then
    v_out := array_append(v_out, 'objection');
  end if;
  if private.setting_bool('certificates.require_full_payment', true) then
    if exists (select 1 from public.invoices where parcel_id = p_parcel and status in ('issued', 'partially_paid') and balance > 0) then
      v_out := array_append(v_out, 'unpaid');
    end if;
  elsif exists (select 1 from public.invoices where parcel_id = p_parcel and status in ('issued', 'partially_paid') and balance > 0 and due_date < current_date) then
    v_out := array_append(v_out, 'overdue');
  end if;
  if not exists (select 1 from public.parcel_owners where parcel_id = p_parcel and valid_to is null) then
    v_out := array_append(v_out, 'no_owner');
  end if;
  return v_out;
end;
$$;

/** Everything printed on the document, frozen at issue time (later changes need a new document). */
create or replace function private.certificate_snapshot(p_parcel uuid)
returns jsonb
language sql
stable
security definer
set search_path = extensions
as $$
  select jsonb_build_object(
    'pun', p.pun, 'account_no', p.account_no, 'area_m2', p.area_m2, 'perimeter_m', p.perimeter_m,
    'land_use', p.land_use, 'ownership', p.ownership, 'plot_no', p.plot_no, 'deed_no', p.deed_no,
    'registered_at', p.registered_at,
    'district', jsonb_build_object('code', d.code, 'name_so', d.name_so, 'name_en', d.name_en),
    'neighbourhood', jsonb_build_object('code', n.code, 'name_so', n.name_so, 'name_en', n.name_en),
    'centroid', jsonb_build_array(round(st_x(p.centroid)::numeric, 6), round(st_y(p.centroid)::numeric, 6)),
    'geom', st_asgeojson(p.geom, 7)::jsonb,
    'neighbours', coalesce((select s.neighbours from public.surveys s where s.parcel_id = p.id and s.status = 'submitted' order by s.submitted_at desc nulls last limit 1), '{}'::jsonb),
    'adjacent', coalesce((select jsonb_agg(jsonb_build_object('pun', q.pun, 'geom', st_asgeojson(q.geom, 7)::jsonb))
                          from public.parcels q where q.id <> p.id and q.deleted_at is null and st_dwithin(q.geom::geography, p.geom::geography, 30)), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('party_id', pa.id, 'full_name', pa.full_name, 'mother_name', pa.mother_name,
                                                           'id_type', pa.id_type, 'id_number', pa.id_number, 'role', po.role, 'share_pct', po.share_pct,
                                                           'photo_path', pa.photo_path) order by po.share_pct desc nulls last, pa.full_name)
                        from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                        where po.parcel_id = p.id and po.valid_to is null), '[]'::jsonb),
    'registrar', (select pr.full_name from public.profiles pr where pr.user_id = auth.uid()))
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  where p.id = p_parcel;
$$;

create or replace function private.issue_document(p_type public.document_type, p_parcel uuid, p_party uuid, p_replaces uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_snap jsonb;
  v_id uuid;
  v_year int := extract(year from current_date)::int;
  v_prefix text := case when p_type = 'certificate' then 'CERT' else 'IDC' end;
begin
  select * into v_p from public.parcels where id = p_parcel;
  v_snap := private.certificate_snapshot(p_parcel);
  if p_type = 'id_card' then
    v_snap := v_snap || jsonb_build_object('holder', (select o from jsonb_array_elements(v_snap -> 'owners') o where (o ->> 'party_id')::uuid = p_party));
  end if;
  insert into public.issued_documents (type, serial, verify_code, parcel_id, party_id, district_id, snapshot, issued_by, expires_at, replaces_id)
  values (p_type, v_prefix || '-' || v_year || '-' || lpad(private.next_serial(v_prefix || '-' || v_year)::text, 6, '0'),
          private.new_verify_code(), p_parcel, p_party, v_p.district_id, v_snap, auth.uid(),
          case when p_type = 'id_card' then (current_date + make_interval(years => private.setting_int('certificates.id_card_years', 5)))::date end,
          p_replaces)
  returning id into v_id;
  perform private.parcel_event(p_parcel, p_type::text || '_issued', null, jsonb_build_object('document_id', v_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.certificate_eligibility(p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  if v.id is null or not private.can_view_document(v.district_id, v.id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return jsonb_build_object('blockers', to_jsonb(private.certificate_blockers(p_parcel)),
                            'has_certificate', exists (select 1 from public.issued_documents where parcel_id = p_parcel and type = 'certificate' and status = 'valid'));
end;
$$;

/** Issue the parcel's title certificate and an ID card for every current owner who has none. */
create or replace function public.certificate_issue(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_blockers text[];
  v_cert uuid;
  v_cards int := 0;
  r record;
begin
  perform private.assert_permission('certificates.approve');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  v_blockers := private.certificate_blockers(p_parcel);
  if cardinality(v_blockers) > 0 then
    perform private.raise_app_error('CONFLICT', 'not_eligible:' || array_to_string(v_blockers, ','));
  end if;
  if exists (select 1 from public.issued_documents where parcel_id = p_parcel and type = 'certificate' and status = 'valid') then
    perform private.raise_app_error('CONFLICT', 'already_issued');
  end if;
  v_cert := private.issue_document('certificate', p_parcel, null, null);
  for r in select po.party_id from public.parcel_owners po where po.parcel_id = p_parcel and po.valid_to is null
           and not exists (select 1 from public.issued_documents d where d.parcel_id = p_parcel and d.party_id = po.party_id and d.type = 'id_card' and d.status = 'valid') loop
    perform private.issue_document('id_card', p_parcel, r.party_id, null);
    v_cards := v_cards + 1;
  end loop;
  return jsonb_build_object('certificate_id', v_cert, 'id_cards', v_cards);
end;
$$;

/** Log the first print. Any later print must go through a reprint request. */
create or replace function public.document_print(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
begin
  perform private.assert_permission('certificates.print');
  select * into v from public.issued_documents where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if v.print_count > 0 then
    perform private.raise_app_error('CONFLICT', 'already_printed');
  end if;
  update public.issued_documents set print_count = print_count + 1 where id = p_id;
  insert into public.print_jobs (document_id, kind, printed_by) values (p_id, case when v.replaces_id is null then 'original' else 'reprint' end, auth.uid());
  perform private.parcel_event(v.parcel_id, v.type::text || '_printed', null, jsonb_build_object('document_id', p_id, 'serial', v.serial));
  return jsonb_build_object('serial', v.serial, 'print_count', v.print_count + 1);
end;
$$;

/** Ask for a reprint: records the reason and raises the certificate fee invoice. */
create or replace function public.reprint_request(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_fee uuid;
  v_inv uuid;
  v_req uuid;
  v_amount numeric;
begin
  perform private.assert_permission('certificates.reprint');
  select * into v from public.issued_documents where id = p_id;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if exists (select 1 from public.reprint_requests where document_id = p_id and status = 'pending') then
    perform private.raise_app_error('CONFLICT', 'reprint_pending');
  end if;
  select id, amount into v_fee, v_amount from public.fee_types where code = 'certificate_fee' and active;
  if v_fee is not null and v_amount > 0 then
    -- Raised directly (the registrar needn't hold invoices.create): same rules as invoice_create.
    insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
    values (private.invoice_number(extract(year from current_date)::int), v.parcel_id, v.district_id, v_fee,
            to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-certificate_fee-' || v.parcel_id),
            current_date, current_date + 30, v_amount, 'Reprint of ' || v.serial, auth.uid())
    returning id into v_inv;
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv, 'fee', 'Reprint fee — ' || v.serial, v_amount, auth.uid());
  end if;
  insert into public.reprint_requests (document_id, reason, fee_invoice_id, requested_by) values (p_id, trim(p_reason), v_inv, auth.uid())
  returning id into v_req;
  perform private.parcel_event(v.parcel_id, 'reprint_requested', p_reason, jsonb_build_object('document_id', p_id, 'invoice_id', v_inv));
  return jsonb_build_object('request_id', v_req, 'fee_invoice_id', v_inv);
end;
$$;

/** Approve (fee paid, someone else) → new document with a new serial; the old one is cancelled. */
create or replace function public.reprint_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.reprint_requests;
  v_doc public.issued_documents;
  v_new uuid;
begin
  perform private.assert_permission('certificates.approve');
  select * into v from public.reprint_requests where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'request');
  end if;
  select * into v_doc from public.issued_documents where id = v.document_id for update;
  if not public.can_access_district(v_doc.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'request');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.reprint_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    if v.fee_invoice_id is not null then
      update public.invoices set status = 'cancelled', cancel_reason = 'Reprint rejected' where id = v.fee_invoice_id and paid = 0 and status <> 'cancelled';
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;
  if v.fee_invoice_id is not null and private.setting_bool('certificates.reprint_requires_fee', true)
     and exists (select 1 from public.invoices where id = v.fee_invoice_id and status <> 'paid') then
    perform private.raise_app_error('CONFLICT', 'fee_unpaid');
  end if;
  update public.issued_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Reprinted: ' || v.reason
   where id = v_doc.id;
  v_new := private.issue_document(v_doc.type, v_doc.parcel_id, v_doc.party_id, v_doc.id);
  update public.reprint_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), new_document_id = v_new
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'document_id', v_new);
end;
$$;

create or replace function public.document_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
begin
  perform private.assert_permission('certificates.cancel');
  select * into v from public.issued_documents where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  perform private.assert_maker_checker(v.issued_by);
  update public.issued_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  perform private.parcel_event(v.parcel_id, v.type::text || '_cancelled', p_reason, jsonb_build_object('document_id', p_id));
end;
$$;

/**
 * Public verification by code: status and minimal, non-sensitive facts. Owner names are reduced to
 * initials; no ID numbers, phones or geometry.
 */
create or replace function public.verify_document(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'type', d.type, 'status', case when d.status = 'valid' and d.expires_at is not null and d.expires_at < current_date then 'expired' else d.status::text end,
    'serial', d.serial, 'pun', d.snapshot ->> 'pun', 'issued_at', d.issued_at, 'expires_at', d.expires_at,
    'district', d.snapshot -> 'district' ->> 'name_so', 'district_en', d.snapshot -> 'district' ->> 'name_en',
    'neighbourhood', d.snapshot -> 'neighbourhood' ->> 'name_so', 'neighbourhood_en', d.snapshot -> 'neighbourhood' ->> 'name_en',
    'area_m2', d.snapshot -> 'area_m2', 'cancelled_at', d.cancelled_at,
    'owners', (select jsonb_agg(regexp_replace(o ->> 'full_name', '(\S)\S*', '\1.', 'g'))
               from jsonb_array_elements(case when d.type = 'id_card' then jsonb_build_array(d.snapshot -> 'holder') else d.snapshot -> 'owners' end) o))
  from public.issued_documents d
  where d.verify_code = upper(trim(p_code)) and length(trim(p_code)) = 12;
$$;

create or replace function public.certificates_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'valid_certificates', (select count(*) from public.issued_documents where type = 'certificate' and status = 'valid'),
    'unprinted', (select count(*) from public.issued_documents where status = 'valid' and print_count = 0),
    'reprints_pending', (select count(*) from public.reprint_requests where status = 'pending'),
    'registered_without', (select count(*) from public.parcels p where p.status = 'registered' and p.deleted_at is null
                           and not exists (select 1 from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status = 'valid')));
$$;

grant execute on function private.can_view_document(uuid, uuid) to authenticated;
revoke execute on function
  public.certificate_eligibility(uuid), public.certificate_issue(uuid), public.document_print(uuid), public.reprint_request(uuid, text),
  public.reprint_decide(uuid, boolean, text), public.document_cancel(uuid, text), public.certificates_counts(), private.can_view_document(uuid, uuid)
from public, anon;
grant execute on function
  public.certificate_eligibility(uuid), public.certificate_issue(uuid), public.document_print(uuid), public.reprint_request(uuid, text),
  public.reprint_decide(uuid, boolean, text), public.document_cancel(uuid, text), public.certificates_counts()
to authenticated;
revoke execute on function public.verify_document(text) from public;
grant execute on function public.verify_document(text) to anon, authenticated;
revoke execute on function private.new_verify_code(), private.certificate_blockers(uuid), private.certificate_snapshot(uuid),
  private.issue_document(public.document_type, uuid, uuid, uuid)
from public, anon, authenticated;
