-- ============================================================================
-- 0013 Phase 3 — Parties (owners), applications, documents, duplicate checks,
-- public tracking. All writes go through SECURITY DEFINER RPCs with explicit checks;
-- tables are read-only to clients (RLS). Documents live in a private bucket and are
-- only reachable through server-issued signed URLs.
-- ============================================================================

create type public.party_kind as enum ('person', 'organisation');
create type public.id_document_type as enum (
  'national_id', 'passport', 'driving_licence', 'birth_certificate', 'company_registration', 'other'
);
create type public.application_type as enum (
  'new_registration', 'transfer', 'subdivision', 'merge', 'reprint', 'permit', 'correction'
);
create type public.application_status as enum (
  'draft', 'awaiting_payment', 'in_survey', 'surveyed', 'in_verification', 'returned',
  'public_notice', 'approved', 'rejected', 'cancelled'
);
create type public.application_channel as enum ('portal', 'office', 'field');
create type public.application_party_role as enum ('owner', 'co_owner', 'agent', 'heir');
create type public.document_status as enum ('pending', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- Parties: persons and organisations (owners, co-owners, agents, heirs).
-- ---------------------------------------------------------------------------
create table public.parties (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.party_kind not null default 'person',
  full_name           text not null check (length(trim(full_name)) >= 2),
  mother_name         text,
  gender              text check (gender in ('male', 'female')),
  date_of_birth       date check (date_of_birth is null or date_of_birth between '1900-01-01' and current_date),
  nationality         text not null default 'SO' check (nationality ~ '^[A-Z]{2}$'),
  id_type             public.id_document_type,
  id_number           text,
  phone               text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at   timestamptz,
  email               text,
  address             text,
  next_of_kin         jsonb not null default '{}'::jsonb,
  org_registration_no text,
  photo_path          text,
  -- District where the record was registered (scopes district staff); null = citizen-created.
  district_id         uuid references public.districts (id),
  citizen_user_id     uuid references auth.users (id) on delete set null,
  legacy_id           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  deleted_at          timestamptz,
  constraint id_pair check ((id_type is null) = (id_number is null))
);
create unique index parties_id_document_key on public.parties (id_type, upper(regexp_replace(id_number, '\s', '', 'g')))
  where id_number is not null and deleted_at is null;
create unique index parties_citizen_key on public.parties (citizen_user_id) where citizen_user_id is not null and deleted_at is null;
create index parties_phone_idx on public.parties (phone);
create index parties_district_idx on public.parties (district_id);
create index parties_created_by_idx on public.parties (created_by);
create index parties_name_trgm on public.parties using gin (full_name extensions.gin_trgm_ops);
create index parties_mother_trgm on public.parties using gin (mother_name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create sequence public.application_number_seq;

create table public.applications (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  type                public.application_type not null default 'new_registration',
  status              public.application_status not null default 'draft',
  channel             public.application_channel not null,
  district_id         uuid not null references public.districts (id),
  neighbourhood_id    uuid references public.neighbourhoods (id),
  pin                 extensions.geometry(Point, 4326),
  pin_accuracy_m      numeric(8, 2),
  address_note        text not null default '',
  plot_no             text,
  old_deed_no         text,
  govt_file_no        text,
  applicant_party_id  uuid references public.parties (id),
  citizen_user_id     uuid references auth.users (id) on delete set null,
  submitted_at        timestamptz,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null
);
create index applications_status_idx on public.applications (status);
create index applications_district_idx on public.applications (district_id, status);
create index applications_neighbourhood_idx on public.applications (neighbourhood_id);
create index applications_applicant_idx on public.applications (applicant_party_id);
create index applications_citizen_idx on public.applications (citizen_user_id);
create index applications_created_by_idx on public.applications (created_by);
create index applications_pin_gist on public.applications using gist (pin);

create table public.application_parties (
  application_id  uuid not null references public.applications (id) on delete cascade,
  party_id        uuid not null references public.parties (id),
  role            public.application_party_role not null default 'owner',
  share_pct       numeric(5, 2) check (share_pct is null or (share_pct > 0 and share_pct <= 100)),
  added_by        uuid references auth.users (id) on delete set null,
  added_at        timestamptz not null default now(),
  primary key (application_id, party_id)
);
create index application_parties_party_idx on public.application_parties (party_id);

create table public.document_types (
  code         text primary key check (code ~ '^[a-z_]+$'),
  name_so      text not null,
  name_en      text not null,
  description  text not null default '',
  required_for public.application_type[] not null default '{}',
  sort         int not null default 0
);

create table public.application_documents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications (id) on delete cascade,
  doc_type        text not null references public.document_types (code),
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes      int not null check (size_bytes > 0 and size_bytes <= 10485760),
  status          public.document_status not null default 'pending',
  review_note     text,
  uploaded_by     uuid references auth.users (id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  deleted_at      timestamptz
);
create index application_documents_app_idx on public.application_documents (application_id);

create table public.application_events (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications (id) on delete cascade,
  action          text not null,
  from_status     public.application_status,
  to_status       public.application_status,
  note            text,
  actor_id        uuid references auth.users (id) on delete set null,
  at              timestamptz not null default now()
);
create index application_events_app_idx on public.application_events (application_id, at);

insert into public.document_types (code, name_so, name_en, required_for, sort) values
  ('identity',          'Kaadhka aqoonsiga / baasaboor', 'National ID or passport',  '{new_registration,transfer,correction,reprint}', 10),
  ('old_deed',          'Warqadda lahaanshaha hore',     'Old title deed',           '{new_registration}', 20),
  ('sale_agreement',    'Heshiiska iibka',               'Sale agreement',           '{transfer}', 30),
  ('transfer_paper',    'Warqadda wareejinta',           'Transfer paper',           '{}', 40),
  ('stamp_duty',        'Rasiidka canshuurta shaabadda', 'Stamp-duty receipt',       '{}', 50),
  ('court_order',       'Amarka maxkamadda',             'Court order',              '{}', 60),
  ('heirs_certificate', 'Shahaadada dhaxalka',           'Heirs certificate',        '{}', 70),
  ('site_photo',        'Sawirka goobta',                'Site photo',               '{}', 80),
  ('other',             'Dukumenti kale',                'Other document',           '{}', 90);

-- Legal records: users who created any of these can never be hard deleted.
insert into private.user_record_tables (table_name) values ('parties'), ('applications');

-- Triggers: updated_at + audit (parties and applications; events are their own log)
create trigger set_updated_at before update on public.parties for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.applications for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.parties for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.applications for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Visibility helpers (used by RLS and RPCs)
-- ---------------------------------------------------------------------------
create or replace function private.can_view_application(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.applications a
    where a.id = p_id
      and private.caller_is_active()
      and (a.citizen_user_id = auth.uid()
           or a.created_by = auth.uid()
           or (public.has_permission('applications.view') and public.can_access_district(a.district_id)))
  );
$$;

/** Who may still change an application: the applicant (draft/returned) or district staff. */
create or replace function private.assert_can_edit_application(p_id uuid)
returns public.applications
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  select * into v from public.applications where id = p_id;
  if v is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status not in ('draft', 'returned') then
    perform private.raise_app_error('CONFLICT', 'not editable');
  end if;
  if not (v.citizen_user_id = auth.uid() or v.created_by = auth.uid()
          or (public.has_permission('applications.update') and public.can_access_district(v.district_id))) then
    perform private.raise_app_error('PERMISSION_DENIED', 'applications.update');
  end if;
  return v;
end;
$$;

create or replace function private.application_event(
  p_id uuid, p_action text, p_from public.application_status, p_to public.application_status, p_note text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.application_events (application_id, action, from_status, to_status, note, actor_id)
  values (p_id, p_action, p_from, p_to, nullif(trim(p_note), ''), auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- RLS (reads only; writes via RPC)
-- ---------------------------------------------------------------------------
alter table public.parties enable row level security;
alter table public.applications enable row level security;
alter table public.application_parties enable row level security;
alter table public.document_types enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_events enable row level security;

revoke all on public.parties, public.applications, public.application_parties, public.document_types,
  public.application_documents, public.application_events from anon;
revoke insert, update, delete on public.parties, public.applications, public.application_parties,
  public.document_types, public.application_documents, public.application_events from authenticated;
revoke all on sequence public.application_number_seq from anon, authenticated;

create policy parties_select on public.parties for select to authenticated
  using (
    citizen_user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or ((select public.has_permission('owners.view'))
        and deleted_at is null
        and (district_id is null or public.can_access_district(district_id)))
    or exists (select 1 from public.application_parties ap
               where ap.party_id = parties.id and private.can_view_application(ap.application_id))
  );

create policy applications_select on public.applications for select to authenticated
  using (private.can_view_application(id));
create policy application_parties_select on public.application_parties for select to authenticated
  using (private.can_view_application(application_id));
create policy application_documents_select on public.application_documents for select to authenticated
  using (deleted_at is null and private.can_view_application(application_id));
create policy application_events_select on public.application_events for select to authenticated
  using (private.can_view_application(application_id));
create policy document_types_select on public.document_types for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------
create or replace function private.normalise_id_number(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '');
$$;

/**
 * Create or update a party. p: {kind, full_name, mother_name, gender, date_of_birth,
 * nationality, id_type, id_number, phone, email, address, next_of_kin, org_registration_no,
 * district_id}. Staff need owners.create/update in the district.
 */
create or replace function public.save_party(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_existing public.parties;
  v_id_number text := private.normalise_id_number(p ->> 'id_number');
  v_id_type public.id_document_type := case when v_id_number is null then null else nullif(p ->> 'id_type', '')::public.id_document_type end;
begin
  if p_id is null then
    perform private.assert_permission('owners.create');
  else
    perform private.assert_permission('owners.update');
    select * into v_existing from public.parties where id = p_id and deleted_at is null;
    if v_existing is null then
      perform private.raise_app_error('NOT_FOUND', 'party');
    end if;
    if v_existing.district_id is not null and not public.can_access_district(v_existing.district_id) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end if;
  if v_district is not null and not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  if v_id_number is not null and v_id_type is null then
    perform private.raise_app_error('VALIDATION', 'id_type');
  end if;
  if v_id_number is not null and exists (
       select 1 from public.parties
       where id_type = v_id_type and private.normalise_id_number(id_number) = v_id_number
         and deleted_at is null and id is distinct from p_id) then
    perform private.raise_app_error('CONFLICT', 'id_number');
  end if;

  if p_id is null then
    insert into public.parties (kind, full_name, mother_name, gender, date_of_birth, nationality, id_type, id_number,
                                phone, email, address, next_of_kin, org_registration_no, district_id, created_by)
    values (coalesce(nullif(p ->> 'kind', ''), 'person')::public.party_kind, trim(p ->> 'full_name'),
            nullif(trim(p ->> 'mother_name'), ''), nullif(p ->> 'gender', ''), nullif(p ->> 'date_of_birth', '')::date,
            coalesce(nullif(p ->> 'nationality', ''), 'SO'), v_id_type, v_id_number,
            nullif(p ->> 'phone', ''), nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'address'), ''),
            coalesce(p -> 'next_of_kin', '{}'::jsonb), nullif(trim(p ->> 'org_registration_no'), ''), v_district, auth.uid())
    returning id into v_id;
  else
    update public.parties
       set kind = coalesce(nullif(p ->> 'kind', ''), kind::text)::public.party_kind,
           full_name = trim(p ->> 'full_name'),
           mother_name = nullif(trim(p ->> 'mother_name'), ''),
           gender = nullif(p ->> 'gender', ''),
           date_of_birth = nullif(p ->> 'date_of_birth', '')::date,
           nationality = coalesce(nullif(p ->> 'nationality', ''), 'SO'),
           id_type = v_id_type,
           id_number = v_id_number,
           -- A changed phone number is no longer verified.
           phone_verified_at = case when nullif(p ->> 'phone', '') is distinct from phone then null else phone_verified_at end,
           phone = nullif(p ->> 'phone', ''),
           email = nullif(lower(trim(p ->> 'email')), ''),
           address = nullif(trim(p ->> 'address'), ''),
           next_of_kin = coalesce(p -> 'next_of_kin', '{}'::jsonb),
           org_registration_no = nullif(trim(p ->> 'org_registration_no'), ''),
           district_id = coalesce(v_district, district_id)
     where id = p_id;
  end if;
  return v_id;
end;
$$;

/** The signed-in citizen's own party record (created from their profile the first time). */
create or replace function public.my_party()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select id into v_id from public.parties where citizen_user_id = auth.uid() and deleted_at is null;
  if v_id is not null then
    return v_id;
  end if;
  select * into v_profile from public.profiles where user_id = auth.uid();
  insert into public.parties (kind, full_name, phone, phone_verified_at, email, citizen_user_id, created_by)
  values ('person', coalesce(nullif(trim(v_profile.full_name), ''), 'Muwaadin'), v_profile.phone,
          case when v_profile.phone is not null then now() end, v_profile.email, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/** Citizens complete their own party details (name, mother's name, ID …). */
create or replace function public.update_my_party(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.my_party();
  v_id_number text := private.normalise_id_number(p ->> 'id_number');
  v_id_type public.id_document_type := case when v_id_number is null then null else nullif(p ->> 'id_type', '')::public.id_document_type end;
begin
  if v_id_number is not null and exists (
       select 1 from public.parties where id_type = v_id_type and private.normalise_id_number(id_number) = v_id_number
         and deleted_at is null and id <> v_id) then
    perform private.raise_app_error('CONFLICT', 'id_number');
  end if;
  update public.parties
     set full_name = coalesce(nullif(trim(p ->> 'full_name'), ''), full_name),
         mother_name = nullif(trim(p ->> 'mother_name'), ''),
         gender = nullif(p ->> 'gender', ''),
         date_of_birth = nullif(p ->> 'date_of_birth', '')::date,
         nationality = coalesce(nullif(p ->> 'nationality', ''), nationality),
         id_type = v_id_type,
         id_number = v_id_number,
         email = nullif(lower(trim(p ->> 'email')), ''),
         address = nullif(trim(p ->> 'address'), '')
   where id = v_id;
  return v_id;
end;
$$;

/** Searchable owner picker (staff). */
create or replace function public.search_parties(p_q text, p_limit int default 20)
returns table (id uuid, kind public.party_kind, full_name text, mother_name text, id_type public.id_document_type,
               id_number text, phone text)
language sql
stable
security invoker
set search_path = extensions
as $$
  select p.id, p.kind, p.full_name, p.mother_name, p.id_type, p.id_number, p.phone
  from public.parties p
  where p.deleted_at is null
    and (coalesce(trim(p_q), '') = ''
         or p.full_name ilike '%' || trim(p_q) || '%'
         or p.phone like '%' || regexp_replace(p_q, '[^0-9+]', '', 'g') || '%' and length(regexp_replace(p_q, '[^0-9]', '', 'g')) >= 4
         or private.normalise_id_number(p.id_number) = private.normalise_id_number(p_q)
         or similarity(p.full_name, trim(p_q)) > 0.35)
  order by similarity(p.full_name, coalesce(p_q, '')) desc, p.full_name
  limit least(greatest(p_limit, 1), 50);
$$;

/**
 * Real-time duplicate check (§4.1): same ID document, same phone, or a similar name with
 * a similar mother's name. Staff with owners.view get the matching records; others only
 * learn that a possible duplicate exists (no personal data leaks to citizens).
 */
create or replace function public.find_duplicate_parties(
  p_full_name text, p_mother_name text, p_id_type text, p_id_number text, p_phone text, p_exclude uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_id_number text := private.normalise_id_number(p_id_number);
  v_matches jsonb;
begin
  if not private.caller_is_active() then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;

  select coalesce(jsonb_agg(m order by m.score desc), '[]'::jsonb) into v_matches
  from (
    select p.id, p.full_name, p.mother_name, p.phone, p.id_type, p.id_number,
           array_remove(array[
             case when v_id_number is not null and p.id_type::text = p_id_type
                       and private.normalise_id_number(p.id_number) = v_id_number then 'same_id' end,
             case when nullif(p_phone, '') is not null and p.phone = p_phone then 'same_phone' end,
             case when length(coalesce(p_full_name, '')) >= 3
                       and similarity(p.full_name, p_full_name) > 0.55
                       and (coalesce(p_mother_name, '') = '' or p.mother_name is null
                            or similarity(p.mother_name, p_mother_name) > 0.5) then 'similar_name' end
           ], null) as reasons,
           greatest(similarity(p.full_name, coalesce(p_full_name, '')),
                    case when p.phone = p_phone then 0.9 else 0 end,
                    case when private.normalise_id_number(p.id_number) = v_id_number then 1 else 0 end) as score
    from public.parties p
    where p.deleted_at is null
      and p.id is distinct from p_exclude
      and ((v_id_number is not null and private.normalise_id_number(p.id_number) = v_id_number)
           or (nullif(p_phone, '') is not null and p.phone = p_phone)
           or (length(coalesce(p_full_name, '')) >= 3 and p.full_name % p_full_name))
    limit 10
  ) m
  where cardinality(m.reasons) > 0;

  if public.has_permission('owners.view') then
    return jsonb_build_object('count', jsonb_array_length(v_matches), 'matches', v_matches);
  end if;
  return jsonb_build_object('count', jsonb_array_length(v_matches),
    'reasons', (select coalesce(jsonb_agg(distinct r), '[]'::jsonb) from jsonb_array_elements(v_matches) e,
                jsonb_array_elements_text(e -> 'reasons') r));
end;
$$;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create or replace function private.application_point(p jsonb)
returns extensions.geometry
language sql
immutable
set search_path = extensions
as $$
  select case when p ? 'pin_lon' and p ? 'pin_lat' and nullif(p ->> 'pin_lon', '') is not null
              then st_setsrid(st_makepoint((p ->> 'pin_lon')::float8, (p ->> 'pin_lat')::float8), 4326) end;
$$;

/** Validates district / neighbourhood / pin consistency and returns the resolved neighbourhood. */
create or replace function private.check_application_location(
  p_district uuid, p_neighbourhood uuid, p_pin extensions.geometry
) returns uuid
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_n public.neighbourhoods;
begin
  if p_pin is not null and not st_within(p_pin, st_makeenvelope(40, -2, 52, 12.5, 4326)) then
    perform private.raise_app_error('VALIDATION', 'pin_outside_somalia');
  end if;
  if p_neighbourhood is null and p_pin is not null then
    select * into v_n from public.neighbourhoods
     where deleted_at is null and geom is not null and st_intersects(geom, p_pin) limit 1;
  elsif p_neighbourhood is not null then
    select * into v_n from public.neighbourhoods where id = p_neighbourhood and deleted_at is null;
    if v_n is null then
      perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
    end if;
    if p_pin is not null and v_n.geom is not null and not st_intersects(v_n.geom, p_pin) then
      perform private.raise_app_error('VALIDATION', 'pin_outside_neighbourhood');
    end if;
  end if;
  if v_n.id is not null and v_n.district_id <> p_district then
    perform private.raise_app_error('VALIDATION', 'neighbourhood_district');
  end if;
  return v_n.id;
end;
$$;

/**
 * Start an application (draft). p: {type, channel, district_id, neighbourhood_id, pin_lon,
 * pin_lat, pin_accuracy_m, address_note, plot_no, old_deed_no, govt_file_no}.
 * Citizens: channel is forced to 'portal' and they become the applicant.
 */
create or replace function public.application_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_staff boolean := private.caller_is_staff();
  v_district uuid := (p ->> 'district_id')::uuid;
  v_pin extensions.geometry := private.application_point(p);
  v_neighbourhood uuid;
  v_id uuid;
  v_number text;
  v_party uuid;
begin
  perform private.assert_permission('applications.create');
  if v_district is null or not exists (select 1 from public.districts where id = v_district and deleted_at is null) then
    perform private.raise_app_error('VALIDATION', 'district');
  end if;
  if v_is_staff and not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  v_neighbourhood := private.check_application_location(v_district, nullif(p ->> 'neighbourhood_id', '')::uuid, v_pin);

  v_number := 'APP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_number_seq')::text, 6, '0');
  if not v_is_staff then
    v_party := public.my_party();
  end if;

  insert into public.applications (number, type, channel, district_id, neighbourhood_id, pin, pin_accuracy_m,
                                   address_note, plot_no, old_deed_no, govt_file_no, applicant_party_id,
                                   citizen_user_id, created_by)
  values (v_number,
          coalesce(nullif(p ->> 'type', ''), 'new_registration')::public.application_type,
          case when v_is_staff then coalesce(nullif(p ->> 'channel', ''), 'office')::public.application_channel
               else 'portal'::public.application_channel end,
          v_district, v_neighbourhood, v_pin, nullif(p ->> 'pin_accuracy_m', '')::numeric,
          coalesce(trim(p ->> 'address_note'), ''), nullif(trim(p ->> 'plot_no'), ''),
          nullif(trim(p ->> 'old_deed_no'), ''), nullif(trim(p ->> 'govt_file_no'), ''),
          v_party, case when v_is_staff then null else auth.uid() end, auth.uid())
  returning id into v_id;

  if v_party is not null then
    insert into public.application_parties (application_id, party_id, role, share_pct, added_by)
    values (v_id, v_party, 'owner', 100, auth.uid());
  end if;

  perform private.application_event(v_id, 'created', null, 'draft', null);
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

create or replace function public.application_update(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
  v_district uuid := coalesce(nullif(p ->> 'district_id', '')::uuid, v.district_id);
  v_pin extensions.geometry := coalesce(private.application_point(p), v.pin);
  v_neighbourhood uuid;
begin
  if private.caller_is_staff() and not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  v_neighbourhood := private.check_application_location(
    v_district,
    case when p ? 'neighbourhood_id' then nullif(p ->> 'neighbourhood_id', '')::uuid else v.neighbourhood_id end,
    v_pin);

  update public.applications
     set type = coalesce(nullif(p ->> 'type', ''), type::text)::public.application_type,
         district_id = v_district,
         neighbourhood_id = v_neighbourhood,
         pin = v_pin,
         pin_accuracy_m = coalesce(nullif(p ->> 'pin_accuracy_m', '')::numeric, pin_accuracy_m),
         address_note = coalesce(trim(p ->> 'address_note'), address_note),
         plot_no = case when p ? 'plot_no' then nullif(trim(p ->> 'plot_no'), '') else plot_no end,
         old_deed_no = case when p ? 'old_deed_no' then nullif(trim(p ->> 'old_deed_no'), '') else old_deed_no end,
         govt_file_no = case when p ? 'govt_file_no' then nullif(trim(p ->> 'govt_file_no'), '') else govt_file_no end
   where id = p_id;
end;
$$;

/** Replace the owners/co-owners/agents list. p_parties: [{party_id, role, share_pct}]. */
create or replace function public.application_set_parties(p_id uuid, p_parties jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
  v_item jsonb;
begin
  if jsonb_typeof(p_parties) <> 'array' then
    perform private.raise_app_error('VALIDATION', 'parties');
  end if;
  for v_item in select * from jsonb_array_elements(p_parties) loop
    if not exists (select 1 from public.parties where id = (v_item ->> 'party_id')::uuid and deleted_at is null) then
      perform private.raise_app_error('NOT_FOUND', 'party');
    end if;
  end loop;

  delete from public.application_parties where application_id = p_id;
  insert into public.application_parties (application_id, party_id, role, share_pct, added_by)
  select p_id, (x ->> 'party_id')::uuid, coalesce(nullif(x ->> 'role', ''), 'owner')::public.application_party_role,
         nullif(x ->> 'share_pct', '')::numeric, auth.uid()
  from jsonb_array_elements(p_parties) x;

  update public.applications
     set applicant_party_id = coalesce(
           (select party_id from public.application_parties where application_id = p_id and party_id = v.applicant_party_id),
           (select party_id from public.application_parties where application_id = p_id and role in ('owner', 'co_owner')
            order by share_pct desc nulls last limit 1))
   where id = p_id;
end;
$$;

/** Register an uploaded file (the server uploads it to the private bucket first). */
create or replace function public.application_add_document(
  p_id uuid, p_doc_type text, p_storage_path text, p_file_name text, p_mime text, p_size int
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid;
begin
  perform private.assert_can_edit_application(p_id);
  if p_storage_path not like p_id::text || '/%' then
    perform private.raise_app_error('VALIDATION', 'storage_path');
  end if;
  insert into public.application_documents (application_id, doc_type, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_id, p_doc_type, p_storage_path, left(p_file_name, 200), p_mime, p_size, auth.uid())
  returning id into v_doc;
  perform private.application_event(p_id, 'document_added', null, null, p_doc_type);
  return v_doc;
end;
$$;

create or replace function public.application_remove_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
begin
  select application_id into v_app from public.application_documents where id = p_doc_id and deleted_at is null;
  if v_app is null then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  perform private.assert_can_edit_application(v_app);
  update public.application_documents set deleted_at = now() where id = p_doc_id;
  perform private.application_event(v_app, 'document_removed', null, null, null);
end;
$$;

/** Storage path for a signed download URL — only if the caller can see the application. */
create or replace function public.application_document_path(p_doc_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.storage_path from public.application_documents d
  where d.id = p_doc_id and d.deleted_at is null and private.can_view_application(d.application_id);
$$;

/** Problems that block submission (empty array = ready). */
create or replace function public.application_checklist(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_problems jsonb := '[]'::jsonb;
  v_share numeric;
  v_owners int;
begin
  select * into v from public.applications where id = p_id;
  if v is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;

  select count(*), coalesce(sum(share_pct), 0) into v_owners, v_share
  from public.application_parties where application_id = p_id and role in ('owner', 'co_owner');

  if v_owners = 0 then
    v_problems := v_problems || jsonb_build_object('code', 'no_owner');
  elsif v_share <> 100 then
    v_problems := v_problems || jsonb_build_object('code', 'shares_not_100', 'value', v_share);
  end if;
  if v.neighbourhood_id is null then
    v_problems := v_problems || jsonb_build_object('code', 'no_neighbourhood');
  end if;
  if v.type = 'new_registration' and v.pin is null then
    v_problems := v_problems || jsonb_build_object('code', 'no_pin');
  end if;
  v_problems := v_problems || coalesce((
    select jsonb_agg(jsonb_build_object('code', 'missing_document', 'value', dt.code))
    from public.document_types dt
    where v.type = any (dt.required_for)
      and not exists (select 1 from public.application_documents d
                      where d.application_id = p_id and d.doc_type = dt.code and d.deleted_at is null)), '[]'::jsonb);
  return v_problems;
end;
$$;

/** Nearby active applications (within p_meters of the pin) for the duplicate panel. */
create or replace function public.application_nearby(p_id uuid, p_meters double precision default 10)
returns table (id uuid, number text, status public.application_status, distance_m double precision)
language sql
stable
security definer
set search_path = extensions
as $$
  select o.id, o.number, o.status, st_distance(a.pin::geography, o.pin::geography)
  from public.applications a
  join public.applications o on o.id <> a.id and o.pin is not null
   and o.status not in ('rejected', 'cancelled')
   and st_dwithin(a.pin::geography, o.pin::geography, p_meters)
  where a.id = p_id and a.pin is not null and private.can_view_application(p_id)
  order by 4
  limit 10;
$$;

/** Draft/returned → awaiting_payment (the application fee invoice arrives with Phase 6/7). */
create or replace function public.application_submit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
  v_problems jsonb := public.application_checklist(p_id);
begin
  if jsonb_array_length(v_problems) > 0 then
    perform private.raise_app_error('VALIDATION', 'checklist');
  end if;
  update public.applications
     set status = 'awaiting_payment', submitted_at = coalesce(submitted_at, now()), decision_note = null
   where id = p_id;
  perform private.application_event(p_id, case when v.status = 'returned' then 'resubmitted' else 'submitted' end,
                                    v.status, 'awaiting_payment', null);
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'application.submitted',
      'Codsigaaga ' || v.number || ' waa la gudbiyay', 'Your application ' || v.number || ' was submitted',
      '/portal/applications/' || p_id);
  end if;
  -- One SMS per submission (a resubmission after "returned" sends another).
  insert into public.jobs (kind, payload, created_by)
  values ('sms.application_submitted', jsonb_build_object('application_id', p_id, 'number', v.number), auth.uid());
  return jsonb_build_object('number', v.number, 'status', 'awaiting_payment');
end;
$$;

/**
 * Staff and applicant actions:
 *   return  (staff, applications.update, needs note)  → returned
 *   reject  (staff, applications.approve, needs note) → rejected
 *   cancel  (applicant or staff with applications.cancel; before survey) → cancelled
 */
create or replace function public.application_transition(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_to public.application_status;
  v_is_applicant boolean;
begin
  select * into v from public.applications where id = p_id;
  if v is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  v_is_applicant := v.citizen_user_id = auth.uid() or (v.created_by = auth.uid() and v.citizen_user_id is null and not private.caller_is_staff());

  case p_action
    when 'return' then
      perform private.assert_permission('applications.update');
      if v.status not in ('awaiting_payment', 'in_survey', 'surveyed', 'in_verification') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      v_to := 'returned';
    when 'reject' then
      perform private.assert_permission('applications.approve');
      if v.status in ('draft', 'approved', 'rejected', 'cancelled') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      perform private.assert_maker_checker(v.created_by);
      v_to := 'rejected';
    when 'cancel' then
      if not v_is_applicant then
        perform private.assert_permission('applications.cancel');
      end if;
      if v.status not in ('draft', 'awaiting_payment', 'returned') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      v_to := 'cancelled';
    else
      perform private.raise_app_error('VALIDATION', 'action');
  end case;

  if p_action in ('return', 'reject') then
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    if not public.can_access_district(v.district_id) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end if;

  update public.applications
     set status = v_to,
         decision_note = nullif(trim(p_note), ''),
         decided_at = case when v_to in ('rejected', 'cancelled') then now() else decided_at end
   where id = p_id;
  perform private.application_event(p_id, p_action, v.status, v_to, p_note);
  if v.citizen_user_id is not null and v.citizen_user_id <> auth.uid() then
    perform private.notify(v.citizen_user_id, 'application.' || p_action,
      'Codsigaaga ' || v.number || ': ' || p_action, 'Your application ' || v.number || ': ' || p_action,
      '/portal/applications/' || p_id);
  end if;
end;
$$;

/**
 * Public tracking (/track): status of an application when the caller knows its number
 * and the last 4 digits of the applicant's phone. Returns no personal data.
 */
create or replace function public.application_track(p_number text, p_phone_last4 text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'number', a.number, 'type', a.type, 'status', a.status, 'submitted_at', a.submitted_at,
    'district', d.name_so,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.at) order by e.at), '[]')
               from public.application_events e where e.application_id = a.id and e.to_status is not null))
  from public.applications a
  join public.districts d on d.id = a.district_id
  left join public.parties p on p.id = a.applicant_party_id
  where upper(a.number) = upper(trim(p_number))
    and length(coalesce(p_phone_last4, '')) = 4
    and right(p.phone, 4) = p_phone_last4
    and a.status <> 'draft';
$$;

/** Application queue counts per status (dashboard chips). */
create or replace function public.application_status_counts()
returns table (status public.application_status, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select status, count(*) from public.applications group by status;
$$;

-- ---------------------------------------------------------------------------
-- Private storage bucket for application documents. No client policies: files are
-- uploaded and downloaded by the server after the database permission checks above.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('application-documents', 'application-documents', false, 10485760,
          array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  private.can_view_application(uuid), private.assert_can_edit_application(uuid),
  private.application_event(uuid, text, public.application_status, public.application_status, text),
  private.normalise_id_number(text), private.application_point(jsonb),
  private.check_application_location(uuid, uuid, extensions.geometry),
  public.save_party(uuid, jsonb), public.my_party(), public.update_my_party(jsonb),
  public.search_parties(text, int), public.find_duplicate_parties(text, text, text, text, text, uuid),
  public.application_create(jsonb), public.application_update(uuid, jsonb),
  public.application_set_parties(uuid, jsonb), public.application_add_document(uuid, text, text, text, text, int),
  public.application_remove_document(uuid), public.application_document_path(uuid),
  public.application_checklist(uuid), public.application_nearby(uuid, double precision),
  public.application_submit(uuid), public.application_transition(uuid, text, text),
  public.application_track(text, text), public.application_status_counts()
from public, anon, authenticated;

-- RLS policies call can_view_application as the querying user; search_parties runs as
-- the caller and uses normalise_id_number. Both are side-effect free.
grant execute on function private.can_view_application(uuid), private.normalise_id_number(text) to authenticated;

grant execute on function
  public.save_party(uuid, jsonb), public.my_party(), public.update_my_party(jsonb),
  public.search_parties(text, int), public.find_duplicate_parties(text, text, text, text, text, uuid),
  public.application_create(jsonb), public.application_update(uuid, jsonb),
  public.application_set_parties(uuid, jsonb), public.application_add_document(uuid, text, text, text, text, int),
  public.application_remove_document(uuid), public.application_document_path(uuid),
  public.application_checklist(uuid), public.application_nearby(uuid, double precision),
  public.application_submit(uuid), public.application_transition(uuid, text, text),
  public.application_status_counts()
to authenticated;

grant execute on function public.application_track(text, text) to anon, authenticated;
