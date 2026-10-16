-- ============================================================================
-- 0014 Phase 4 — Survey, GIS validation, verification, public notice, registration,
-- PUN. Flow: awaiting_payment → (fee paid | fee waived) → in_survey → surveyed →
-- (land officer verifies) → public_notice → in_verification → (registrar) → approved,
-- parcel registered with a PUN. Every step is an RPC with explicit checks.
-- ============================================================================

create type public.parcel_status as enum ('draft', 'surveyed', 'verified', 'registered', 'disputed', 'archived');
create type public.land_use as enum ('residential', 'commercial', 'state', 'mixed', 'agricultural', 'other');
create type public.ownership_type as enum ('private', 'public');
create type public.survey_status as enum ('assigned', 'in_progress', 'submitted', 'overlap_review', 'returned', 'cancelled');
create type public.survey_method as enum ('drawn', 'gps_walk', 'imported');
create type public.notice_status as enum ('open', 'closed', 'cancelled');
create type public.objection_status as enum ('open', 'withdrawn', 'dismissed', 'upheld');
create type public.fee_status as enum ('due', 'paid', 'waived');

insert into public.settings (key, value, description) values
  ('survey.overlap_tolerance_m2', '0.5', 'Overlaps smaller than this (m²) are ignored'),
  ('survey.neighbourhood_tolerance_m', '2', 'How far (m) a parcel may extend beyond its neighbourhood'),
  ('survey.min_area_m2', '10', 'Smallest parcel accepted (m²)'),
  ('registration.account_format', '"{district}{serial:7}"', 'Parcel account number format')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Parcels and owners
-- ---------------------------------------------------------------------------
create table public.parcels (
  id                uuid primary key default gen_random_uuid(),
  pun               text unique,
  account_no        text unique,
  application_id    uuid unique references public.applications (id),
  district_id       uuid not null references public.districts (id),
  neighbourhood_id  uuid not null references public.neighbourhoods (id),
  street_id         uuid references public.streets (id),
  plot_no           text,
  deed_no           text,
  govt_file_no      text,
  ownership         public.ownership_type not null default 'private',
  land_use          public.land_use not null default 'residential',
  developed         boolean not null default false,
  area_m2           numeric(12, 2),
  perimeter_m       numeric(12, 2),
  geom              extensions.geometry(Polygon, 4326) not null,
  centroid          extensions.geometry(Point, 4326) generated always as (extensions.st_pointonsurface(geom)) stored,
  status            public.parcel_status not null default 'draft',
  registered_at     timestamptz,
  registered_by     uuid references auth.users (id) on delete set null,
  legacy_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  deleted_at        timestamptz,
  constraint registered_has_pun check (status <> 'registered' or (pun is not null and account_no is not null))
);
create index parcels_geom_gist on public.parcels using gist (geom);
create index parcels_district_idx on public.parcels (district_id, status);
create index parcels_neighbourhood_idx on public.parcels (neighbourhood_id);
create index parcels_street_idx on public.parcels (street_id);
create index parcels_created_by_idx on public.parcels (created_by);
create index parcels_registered_by_idx on public.parcels (registered_by);

create table public.parcel_owners (
  id                     uuid primary key default gen_random_uuid(),
  parcel_id              uuid not null references public.parcels (id),
  party_id               uuid not null references public.parties (id),
  role                   public.application_party_role not null default 'owner',
  share_pct              numeric(5, 2),
  valid_from             date not null default current_date,
  valid_to               date,
  source_application_id  uuid references public.applications (id),
  created_at             timestamptz not null default now()
);
create index parcel_owners_parcel_idx on public.parcel_owners (parcel_id) where valid_to is null;
create index parcel_owners_party_idx on public.parcel_owners (party_id);
create index parcel_owners_app_idx on public.parcel_owners (source_application_id);

create table public.parcel_history (
  id         bigint generated always as identity primary key,
  parcel_id  uuid not null references public.parcels (id),
  action     text not null,
  note       text,
  data       jsonb not null default '{}'::jsonb,
  actor_id   uuid references auth.users (id) on delete set null,
  at         timestamptz not null default now()
);
create index parcel_history_parcel_idx on public.parcel_history (parcel_id, at);

-- Gapless per-district serials (row lock inside the registering transaction).
create table public.pun_counters (
  district_id   uuid primary key references public.districts (id),
  last_serial   int not null default 0,
  last_account  int not null default 0
);

-- ---------------------------------------------------------------------------
-- Surveys, photos, public notices, objections
-- ---------------------------------------------------------------------------
alter table public.applications
  add column fee_status public.fee_status not null default 'due',
  add column fee_note text,
  add column fee_decided_by uuid references auth.users (id) on delete set null,
  add column parcel_id uuid references public.parcels (id),
  add column verified_by uuid references auth.users (id) on delete set null,
  add column verified_at timestamptz,
  add column verification jsonb;
create index applications_parcel_idx on public.applications (parcel_id);
create index applications_verified_by_idx on public.applications (verified_by);
create index applications_fee_decided_by_idx on public.applications (fee_decided_by);

create table public.surveys (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications (id),
  parcel_id       uuid references public.parcels (id),
  district_id     uuid not null references public.districts (id),
  surveyor_id     uuid not null references public.profiles (user_id),
  status          public.survey_status not null default 'assigned',
  due_date        date,
  assigned_by     uuid references auth.users (id) on delete set null,
  assigned_at     timestamptz not null default now(),
  geom            extensions.geometry(Polygon, 4326),
  area_m2         numeric(12, 2),
  perimeter_m     numeric(12, 2),
  accuracy_m      numeric(8, 2),
  method          public.survey_method,
  neighbours      jsonb not null default '{}'::jsonb,
  building        jsonb not null default '{}'::jsonb,
  notes           text,
  overlap_list    jsonb not null default '[]'::jsonb,
  started_at      timestamptz,
  submitted_at    timestamptz,
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index surveys_one_active on public.surveys (application_id) where status <> 'cancelled';
create index surveys_surveyor_idx on public.surveys (surveyor_id, status);
create index surveys_parcel_idx on public.surveys (parcel_id);
create index surveys_district_idx on public.surveys (district_id, status);
create index surveys_assigned_by_idx on public.surveys (assigned_by);
create index surveys_reviewed_by_idx on public.surveys (reviewed_by);
create index surveys_geom_gist on public.surveys using gist (geom);

create table public.survey_photos (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references public.surveys (id),
  storage_path  text not null unique,
  lon           double precision,
  lat           double precision,
  taken_at      timestamptz,
  caption       text,
  uploaded_by   uuid references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz
);
create index survey_photos_survey_idx on public.survey_photos (survey_id);

create table public.public_notices (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications (id),
  parcel_id       uuid not null references public.parcels (id),
  district_id     uuid not null references public.districts (id),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz not null,
  status          public.notice_status not null default 'open',
  created_by      uuid references auth.users (id) on delete set null,
  closed_at       timestamptz
);
create unique index public_notices_one_open on public.public_notices (application_id) where status = 'open';
create index public_notices_parcel_idx on public.public_notices (parcel_id);
create index public_notices_status_idx on public.public_notices (status, ends_at);
create index public_notices_district_idx on public.public_notices (district_id);

create table public.objections (
  id               uuid primary key default gen_random_uuid(),
  notice_id        uuid not null references public.public_notices (id),
  objector_name    text not null check (length(trim(objector_name)) >= 2),
  objector_phone   text check (objector_phone is null or objector_phone ~ '^\+[1-9][0-9]{7,14}$'),
  statement        text not null check (length(trim(statement)) >= 10),
  status           public.objection_status not null default 'open',
  filed_by         uuid references auth.users (id) on delete set null,
  filed_at         timestamptz not null default now(),
  resolved_by      uuid references auth.users (id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text
);
create index objections_notice_idx on public.objections (notice_id, status);
create index objections_filed_by_idx on public.objections (filed_by);

insert into private.user_record_tables (table_name, column_name) values
  ('parcels', 'created_by'), ('surveys', 'surveyor_id'), ('public_notices', 'created_by');

create trigger set_updated_at before update on public.parcels for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.surveys for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.parcels for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.surveys for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.parcel_owners for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.objections for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Helpers about other users (assignment) and parcels
-- ---------------------------------------------------------------------------
create or replace function private.user_has_permission(p_user_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_grants_all(p_user_id) or exists (
    select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = p_user_id and rp.permission_key = p_key);
$$;

create or replace function private.user_can_access_district(p_user_id uuid, p_district_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_all_districts(p_user_id) or p_district_id = any (private.user_district_ids(p_user_id));
$$;

create or replace function private.parcel_event(p_parcel uuid, p_action text, p_note text, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.parcel_history (parcel_id, action, note, data, actor_id)
  values (p_parcel, p_action, nullif(trim(p_note), ''), coalesce(p_data, '{}'::jsonb), auth.uid());
$$;

/** Strict polygon parser for surveys: invalid shapes are rejected (never silently repaired). */
create or replace function private.survey_polygon(p_geojson jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = extensions
as $$
declare
  v geometry;
begin
  begin
    v := st_setsrid(st_geomfromgeojson(case when p_geojson ->> 'type' = 'Feature' then p_geojson -> 'geometry' else p_geojson end), 4326);
  exception when others then
    perform private.raise_app_error('VALIDATION', 'geojson');
  end;
  if st_geometrytype(v) = 'ST_MultiPolygon' and st_numgeometries(v) = 1 then
    v := st_geometryn(v, 1);
  end if;
  if st_geometrytype(v) <> 'ST_Polygon' then
    perform private.raise_app_error('VALIDATION', 'not_a_polygon');
  end if;
  if not st_within(v, st_makeenvelope(40, -2, 52, 12.5, 4326)) then
    perform private.raise_app_error('VALIDATION', 'outside Somalia');
  end if;
  if not st_isvalid(v) then
    perform private.raise_app_error('VALIDATION', 'invalid_polygon');
  end if;
  return v;
end;
$$;

/** Registered/active parcels overlapping a shape by more than the tolerance. */
create or replace function private.parcel_overlaps(p_geom extensions.geometry, p_exclude_parcel uuid)
returns jsonb
language sql
stable
security definer
set search_path = extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('parcel_id', p.id, 'pun', p.pun, 'status', p.status,
                                               'overlap_m2', round(o.a::numeric, 2)) order by o.a desc), '[]'::jsonb)
  from public.parcels p
  cross join lateral (select st_area(st_intersection(p.geom, p_geom)::geography) as a) o
  where p.deleted_at is null
    and p.id is distinct from p_exclude_parcel
    and p.status in ('surveyed', 'verified', 'registered', 'disputed')
    and p.geom && p_geom
    and st_intersects(p.geom, p_geom)
    and o.a > coalesce((select (value #>> '{}')::numeric from public.settings where key = 'survey.overlap_tolerance_m2'), 0.5);
$$;

create or replace function private.format_serial(p_format text, p_district text, p_neighbourhood text, p_serial int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_format;
  m text[];
begin
  v := replace(replace(v, '{district}', p_district), '{neighbourhood}', coalesce(p_neighbourhood, ''));
  m := regexp_match(v, '\{serial:(\d+)\}');
  if m is not null then
    v := replace(v, '{serial:' || m[1] || '}', lpad(p_serial::text, m[1]::int, '0'));
  else
    v := replace(v, '{serial}', p_serial::text);
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create or replace function private.can_view_parcel(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.parcels p
    where p.id = p_id and private.caller_is_active()
      and ((public.has_permission('parcels.view') and public.can_access_district(p.district_id))
           or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                      where po.parcel_id = p.id and po.valid_to is null and pa.citizen_user_id = auth.uid())
           or (p.application_id is not null and private.can_view_application(p.application_id)))
  );
$$;

create or replace function private.can_view_survey(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.surveys s
    where s.id = p_id and private.caller_is_active()
      and (s.surveyor_id = auth.uid()
           or (public.has_permission('surveys.view') and public.can_access_district(s.district_id))
           or private.can_view_application(s.application_id)));
$$;

alter table public.parcels enable row level security;
alter table public.parcel_owners enable row level security;
alter table public.parcel_history enable row level security;
alter table public.pun_counters enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_photos enable row level security;
alter table public.public_notices enable row level security;
alter table public.objections enable row level security;

revoke all on public.parcels, public.parcel_owners, public.parcel_history, public.pun_counters, public.surveys,
  public.survey_photos, public.public_notices, public.objections from anon;
revoke insert, update, delete on public.parcels, public.parcel_owners, public.parcel_history, public.pun_counters,
  public.surveys, public.survey_photos, public.public_notices, public.objections from authenticated;
revoke select on public.pun_counters from authenticated;

create policy parcels_select on public.parcels for select to authenticated using (private.can_view_parcel(id));
create policy parcel_owners_select on public.parcel_owners for select to authenticated using (private.can_view_parcel(parcel_id));
create policy parcel_history_select on public.parcel_history for select to authenticated using (private.can_view_parcel(parcel_id));
create policy surveys_select on public.surveys for select to authenticated using (private.can_view_survey(id));
create policy survey_photos_select on public.survey_photos for select to authenticated
  using (deleted_at is null and private.can_view_survey(survey_id));
create policy public_notices_select on public.public_notices for select to authenticated
  using (private.can_view_application(application_id));
create policy objections_select on public.objections for select to authenticated
  using (filed_by = (select auth.uid())
         or exists (select 1 from public.public_notices n where n.id = notice_id and private.can_view_application(n.application_id)));

-- ---------------------------------------------------------------------------
-- Fee hand-off (Phase 7 calls private.application_fee_settled from the payment flow)
-- ---------------------------------------------------------------------------
create or replace function private.application_fee_settled(p_id uuid, p_status public.fee_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  select * into v from public.applications where id = p_id for update;
  if v.status <> 'awaiting_payment' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.applications
     set fee_status = p_status, fee_note = nullif(trim(p_note), ''), fee_decided_by = auth.uid(), status = 'in_survey'
   where id = p_id;
  perform private.application_event(p_id, 'fee_' || p_status::text, 'awaiting_payment', 'in_survey', p_note);
end;
$$;

/** Fee exemption (mosques, schools, hardship …) — finance approval, never by the creator. */
create or replace function public.application_waive_fee(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  perform private.assert_permission('payments.approve');
  -- Finance staff decide fees by district; they don't need the general applications.view right.
  select * into v from public.applications where id = p_id;
  if v is null then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if not public.can_access_district(v.district_id) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  perform private.assert_maker_checker(v.created_by);
  perform private.application_fee_settled(p_id, 'waived', p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Survey assignment and capture
-- ---------------------------------------------------------------------------
/** Surveyors who could take an application in this district, least busy first. */
create or replace function public.survey_candidates(p_application_id uuid)
returns table (user_id uuid, full_name text, open_tasks bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_district uuid;
begin
  perform private.assert_permission('surveys.approve');
  select district_id into v_district from public.applications where id = p_application_id;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  return query
    select p.user_id, p.full_name,
           (select count(*) from public.surveys s where s.surveyor_id = p.user_id
             and s.status in ('assigned', 'in_progress', 'returned', 'overlap_review')) as open_tasks
    from public.profiles p
    where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
      and not private.user_grants_all(p.user_id)
      and private.user_has_permission(p.user_id, 'surveys.create')
      and private.user_can_access_district(p.user_id, v_district)
    order by 3, p.full_name
    limit 50;
end;
$$;

/** Assign (or reassign) the survey task; with no surveyor given, the least busy one gets it. */
create or replace function public.survey_assign(p_application_id uuid, p_surveyor_id uuid default null, p_due date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_surveyor uuid := p_surveyor_id;
  v_survey public.surveys;
begin
  perform private.assert_permission('surveys.approve');
  select * into v from public.applications where id = p_application_id for update;
  if v is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status <> 'in_survey' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v_surveyor is null then
    select c.user_id into v_surveyor from public.survey_candidates(p_application_id) c limit 1;
    if v_surveyor is null then
      perform private.raise_app_error('NOT_FOUND', 'surveyor');
    end if;
  elsif not (private.user_has_permission(v_surveyor, 'surveys.create')
             and private.user_can_access_district(v_surveyor, v.district_id)
             and exists (select 1 from public.profiles where user_id = v_surveyor and status = 'active' and kind = 'staff')) then
    perform private.raise_app_error('VALIDATION', 'not_a_surveyor');
  end if;

  select * into v_survey from public.surveys where application_id = p_application_id and status <> 'cancelled';
  if v_survey.id is null then
    insert into public.surveys (application_id, district_id, surveyor_id, due_date, assigned_by)
    values (p_application_id, v.district_id, v_surveyor, p_due, auth.uid())
    returning * into v_survey;
  else
    if v_survey.status = 'submitted' then
      perform private.raise_app_error('CONFLICT', 'already_submitted');
    end if;
    update public.surveys set surveyor_id = v_surveyor, due_date = coalesce(p_due, due_date),
                              assigned_by = auth.uid(), assigned_at = now()
     where id = v_survey.id;
  end if;

  perform private.application_event(p_application_id, 'survey_assigned', null, null,
    (select full_name from public.profiles where user_id = v_surveyor));
  perform private.notify(v_surveyor, 'survey.assigned',
    'Sahan cusub: ' || v.number, 'New survey task: ' || v.number, '/surveys/' || v_survey.id);
  return v_survey.id;
end;
$$;

create or replace function private.assert_surveyor(p_survey uuid)
returns public.surveys
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.surveys;
begin
  select * into v from public.surveys where id = p_survey;
  if v is null or not private.can_view_survey(p_survey) then
    perform private.raise_app_error('NOT_FOUND', 'survey');
  end if;
  if v.surveyor_id <> auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'not your survey');
  end if;
  perform private.assert_permission('surveys.update');
  if v.status not in ('assigned', 'in_progress', 'returned') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  return v;
end;
$$;

/**
 * Autosave of field work. p: {geojson, method, accuracy_m, neighbours:{north,east,south,west},
 * building:{type,floors,use,condition}, notes}. Missing keys keep their value.
 */
create or replace function public.survey_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.surveys := private.assert_surveyor(p_id);
  v_geom geometry := case when p ? 'geojson' and p -> 'geojson' <> 'null'::jsonb then private.survey_polygon(p -> 'geojson') end;
begin
  update public.surveys
     set geom = case when p ? 'geojson' then v_geom else geom end,
         area_m2 = case when p ? 'geojson' then round(st_area(v_geom::geography)::numeric, 2) else area_m2 end,
         perimeter_m = case when p ? 'geojson' then round(st_perimeter(v_geom::geography)::numeric, 2) else perimeter_m end,
         method = coalesce(nullif(p ->> 'method', '')::public.survey_method, method),
         accuracy_m = case when p ? 'accuracy_m' then nullif(p ->> 'accuracy_m', '')::numeric else accuracy_m end,
         neighbours = coalesce(p -> 'neighbours', neighbours),
         building = coalesce(p -> 'building', building),
         notes = case when p ? 'notes' then nullif(trim(p ->> 'notes'), '') else notes end,
         status = 'in_progress',
         started_at = coalesce(started_at, now())
   where id = p_id;
  return (select jsonb_build_object('area_m2', area_m2, 'perimeter_m', perimeter_m) from public.surveys where id = p_id);
end;
$$;

create or replace function public.survey_add_photo(p_id uuid, p_path text, p_lon double precision, p_lat double precision, p_taken timestamptz, p_caption text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo uuid;
begin
  perform private.assert_surveyor(p_id);
  if p_path not like p_id::text || '/%' then
    perform private.raise_app_error('VALIDATION', 'storage_path');
  end if;
  insert into public.survey_photos (survey_id, storage_path, lon, lat, taken_at, caption, uploaded_by)
  values (p_id, p_path, p_lon, p_lat, p_taken, nullif(trim(p_caption), ''), auth.uid())
  returning id into v_photo;
  return v_photo;
end;
$$;

create or replace function public.survey_photo_path(p_photo uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select storage_path from public.survey_photos where id = p_photo and deleted_at is null and private.can_view_survey(survey_id);
$$;

/** Create or refresh the draft/surveyed parcel from an accepted survey shape. */
create or replace function private.survey_to_parcel(p_survey public.surveys, p_status public.parcel_status)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v_app public.applications;
  v_parcel uuid;
  v_developed boolean := coalesce((p_survey.building ->> 'type') not in ('', 'none'), false);
begin
  select * into v_app from public.applications where id = p_survey.application_id;
  select id into v_parcel from public.parcels where application_id = v_app.id;
  if v_parcel is null then
    insert into public.parcels (application_id, district_id, neighbourhood_id, plot_no, deed_no, govt_file_no,
                                area_m2, perimeter_m, geom, status, developed, created_by)
    values (v_app.id, v_app.district_id, v_app.neighbourhood_id, v_app.plot_no, v_app.old_deed_no, v_app.govt_file_no,
            p_survey.area_m2, p_survey.perimeter_m, p_survey.geom, p_status, v_developed, auth.uid())
    returning id into v_parcel;
    update public.applications set parcel_id = v_parcel where id = v_app.id;
  else
    update public.parcels set geom = p_survey.geom, area_m2 = p_survey.area_m2, perimeter_m = p_survey.perimeter_m,
                              status = p_status, developed = v_developed
     where id = v_parcel;
  end if;
  update public.surveys set parcel_id = v_parcel where id = p_survey.id;
  perform private.parcel_event(v_parcel, 'survey_' || p_status::text, null,
    jsonb_build_object('survey_id', p_survey.id, 'area_m2', p_survey.area_m2));
  return v_parcel;
end;
$$;

/**
 * Submit the survey (§4.3): polygon valid, at least the minimum area, inside the chosen
 * neighbourhood (with tolerance), and no overlap with existing parcels. Overlaps go to
 * a GIS officer instead of failing.
 */
create or replace function public.survey_submit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.surveys := private.assert_surveyor(p_id);
  v_app public.applications;
  v_n public.neighbourhoods;
  v_overlaps jsonb;
  v_parcel uuid;
  v_tol double precision := coalesce((select (value #>> '{}')::float8 from public.settings where key = 'survey.neighbourhood_tolerance_m'), 2);
  v_min numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'survey.min_area_m2'), 10);
begin
  if v.geom is null then
    perform private.raise_app_error('VALIDATION', 'no_polygon');
  end if;
  if v.area_m2 < v_min then
    perform private.raise_app_error('VALIDATION', 'too_small');
  end if;
  select * into v_app from public.applications where id = v.application_id for update;
  if v_app.status <> 'in_survey' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  select * into v_n from public.neighbourhoods where id = v_app.neighbourhood_id;
  if v_n.geom is not null and not st_coveredby(v.geom, st_buffer(v_n.geom::geography, v_tol)::geometry) then
    perform private.raise_app_error('VALIDATION', 'outside_neighbourhood');
  end if;

  select id into v_parcel from public.parcels where application_id = v_app.id;
  v_overlaps := private.parcel_overlaps(v.geom, v_parcel);

  update public.surveys
     set overlap_list = v_overlaps, submitted_at = now(),
         status = case when jsonb_array_length(v_overlaps) > 0 then 'overlap_review'::public.survey_status
                       else 'submitted'::public.survey_status end
   where id = p_id
  returning * into v;

  if jsonb_array_length(v_overlaps) > 0 then
    perform private.survey_to_parcel(v, 'draft');
    perform private.application_event(v_app.id, 'survey_overlap', null, null, jsonb_array_length(v_overlaps)::text);
    insert into public.jobs (kind, payload, created_by)
    values ('notify.gis_overlap', jsonb_build_object('survey_id', p_id, 'district_id', v_app.district_id), auth.uid());
  else
    perform private.survey_to_parcel(v, 'surveyed');
    update public.applications set status = 'surveyed' where id = v_app.id;
    perform private.application_event(v_app.id, 'survey_submitted', 'in_survey', 'surveyed', null);
  end if;
  return jsonb_build_object('status', v.status, 'overlaps', v_overlaps, 'area_m2', v.area_m2);
end;
$$;

/** GIS officer: correct the shape and accept, or return the survey to the surveyor. */
create or replace function public.survey_gis_review(p_id uuid, p_action text, p_note text default null, p_geojson jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.surveys;
  v_geom geometry;
  v_overlaps jsonb;
  v_parcel uuid;
begin
  perform private.assert_permission('surveys.approve');
  perform private.assert_permission('map.edit_geometry');
  select * into v from public.surveys where id = p_id for update;
  if v is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'survey');
  end if;
  if v.status <> 'overlap_review' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;

  if p_action = 'return' then
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.surveys set status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = p_id;
    perform private.application_event(v.application_id, 'survey_returned', null, null, p_note);
    perform private.notify(v.surveyor_id, 'survey.returned', 'Sahanka dib ayaa laguu celiyay', 'Your survey was returned', '/surveys/' || p_id);
    return jsonb_build_object('status', 'returned');
  elsif p_action <> 'accept' then
    perform private.raise_app_error('VALIDATION', 'action');
  end if;

  v_geom := coalesce(case when p_geojson is not null then private.survey_polygon(p_geojson) end, v.geom);
  select id into v_parcel from public.parcels where application_id = v.application_id;
  v_overlaps := private.parcel_overlaps(v_geom, v_parcel);
  if jsonb_array_length(v_overlaps) > 0 then
    perform private.raise_app_error('VALIDATION', 'still_overlapping');
  end if;

  update public.surveys
     set geom = v_geom, area_m2 = round(st_area(v_geom::geography)::numeric, 2),
         perimeter_m = round(st_perimeter(v_geom::geography)::numeric, 2),
         overlap_list = '[]'::jsonb, status = 'submitted', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(p_note), '')
   where id = p_id
  returning * into v;
  perform private.survey_to_parcel(v, 'surveyed');
  update public.applications set status = 'surveyed' where id = v.application_id and status = 'in_survey';
  perform private.application_event(v.application_id, 'survey_gis_accepted', 'in_survey', 'surveyed', p_note);
  return jsonb_build_object('status', 'submitted', 'area_m2', v.area_m2);
end;
$$;

-- ---------------------------------------------------------------------------
-- Verification, public notice, objections
-- ---------------------------------------------------------------------------
/**
 * Land officer's first check (§4.4): documents, survey and identity confirmed.
 * Starts the public notice (if configured) or sends it straight to the registrar.
 */
create or replace function public.application_verify(p_id uuid, p_checks jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_days int := private.setting_int('registration.public_notice_days', 14);
  v_to public.application_status;
begin
  perform private.assert_permission('applications.approve');
  select * into v from public.applications where id = p_id for update;
  if v is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status <> 'surveyed' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if not (coalesce((p_checks ->> 'documents_ok')::boolean, false)
          and coalesce((p_checks ->> 'survey_ok')::boolean, false)
          and coalesce((p_checks ->> 'identity_ok')::boolean, false)) then
    perform private.raise_app_error('VALIDATION', 'checklist_incomplete');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if exists (select 1 from public.surveys where application_id = p_id and surveyor_id = auth.uid() and status = 'submitted') then
    perform private.raise_app_error('MAKER_CHECKER', 'surveyor');
  end if;

  v_to := case when v_days > 0 then 'public_notice'::public.application_status else 'in_verification'::public.application_status end;
  update public.applications
     set status = v_to, verified_by = auth.uid(), verified_at = now(), verification = p_checks || jsonb_build_object('note', p_note)
   where id = p_id;
  update public.parcels set status = 'verified' where id = v.parcel_id;
  perform private.parcel_event(v.parcel_id, 'verified', p_note);
  if v_days > 0 then
    insert into public.public_notices (application_id, parcel_id, district_id, ends_at, created_by)
    values (p_id, v.parcel_id, v.district_id, now() + make_interval(days => v_days), auth.uid());
  end if;
  perform private.application_event(p_id, 'verified', 'surveyed', v_to, p_note);
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'application.verified',
      'Codsigaaga ' || v.number || ' waa la hubiyay', 'Your application ' || v.number || ' was verified',
      '/portal/applications/' || p_id);
  end if;
  return jsonb_build_object('status', v_to, 'notice_days', v_days);
end;
$$;

/** Close notices whose period ended; their applications move to the registrar. Run daily. */
create or replace function public.close_due_notices()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.public_notices;
  v_count int := 0;
begin
  for v_n in select * from public.public_notices where status = 'open' and ends_at <= now() for update skip locked loop
    update public.public_notices set status = 'closed', closed_at = now() where id = v_n.id;
    update public.applications set status = 'in_verification' where id = v_n.application_id and status = 'public_notice';
    perform private.application_event(v_n.application_id, 'notice_closed', 'public_notice', 'in_verification',
      (select count(*)::text from public.objections where notice_id = v_n.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

/** File an objection during an open notice (signed-in citizen, or staff recording one received in person). */
create or replace function public.objection_file(p_notice_id uuid, p_name text, p_phone text, p_statement text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.public_notices;
  v_id uuid;
begin
  if not private.caller_is_active() then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select * into v_notice from public.public_notices where id = p_notice_id;
  if v_notice is null or v_notice.status <> 'open' or v_notice.ends_at <= now() then
    perform private.raise_app_error('CONFLICT', 'notice_closed');
  end if;
  if length(trim(coalesce(p_statement, ''))) < 10 then
    perform private.raise_app_error('VALIDATION', 'statement');
  end if;
  if (select count(*) from public.objections where filed_by = auth.uid() and filed_at > now() - interval '1 day') >= 5 then
    perform private.raise_app_error('RATE_LIMITED');
  end if;
  insert into public.objections (notice_id, objector_name, objector_phone, statement, filed_by)
  values (p_notice_id, trim(p_name), nullif(p_phone, ''), trim(p_statement), auth.uid())
  returning id into v_id;
  perform private.application_event(v_notice.application_id, 'objection_filed', null, null, null);
  return v_id;
end;
$$;

/** Legal officer decides; the objector may withdraw their own. An upheld objection marks the parcel disputed. */
create or replace function public.objection_resolve(p_id uuid, p_status public.objection_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.objections;
  v_notice public.public_notices;
begin
  select * into v from public.objections where id = p_id for update;
  if v is null then
    perform private.raise_app_error('NOT_FOUND', 'objection');
  end if;
  select * into v_notice from public.public_notices where id = v.notice_id;
  if v.status <> 'open' or p_status = 'open' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if p_status = 'withdrawn' then
    if v.filed_by is distinct from auth.uid() then
      perform private.assert_permission('disputes.approve');
    end if;
  else
    perform private.assert_permission('disputes.approve');
    if not public.can_access_district(v_notice.district_id) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
  end if;
  update public.objections set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(trim(p_note), '')
   where id = p_id;
  if p_status = 'upheld' then
    update public.parcels set status = 'disputed' where id = v_notice.parcel_id;
    perform private.parcel_event(v_notice.parcel_id, 'disputed', p_note);
  end if;
  perform private.application_event(v_notice.application_id, 'objection_' || p_status::text, null, null, p_note);
end;
$$;

/** Notices currently open, for the public notice board (no personal data). */
create or replace function public.public_notices_active()
returns table (id uuid, application_number text, district text, neighbourhood text, area_m2 numeric,
               starts_at timestamptz, ends_at timestamptz, centroid jsonb, outline jsonb)
language sql
stable
security definer
set search_path = extensions
as $$
  select n.id, a.number, d.name_so, nb.name_so, p.area_m2, n.starts_at, n.ends_at,
         st_asgeojson(p.centroid, 6)::jsonb, st_asgeojson(p.geom, 6)::jsonb
  from public.public_notices n
  join public.applications a on a.id = n.application_id
  join public.parcels p on p.id = n.parcel_id
  join public.districts d on d.id = n.district_id
  left join public.neighbourhoods nb on nb.id = p.neighbourhood_id
  where n.status = 'open' and n.ends_at > now()
  order by n.ends_at;
$$;

-- ---------------------------------------------------------------------------
-- Registration and PUN (§4.5)
-- ---------------------------------------------------------------------------
create or replace function private.next_pun(p_district uuid, p_neighbourhood uuid)
returns table (pun text, account_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial int;
  v_account int;
  v_dcode text;
  v_ncode text;
begin
  insert into public.pun_counters (district_id) values (p_district) on conflict do nothing;
  -- Row lock: concurrent registrations in a district queue here, so numbers have no gaps or duplicates.
  update public.pun_counters set last_serial = last_serial + 1, last_account = last_account + 1
   where district_id = p_district
  returning last_serial, last_account into v_serial, v_account;
  select code into v_dcode from public.districts where id = p_district;
  select code into v_ncode from public.neighbourhoods where id = p_neighbourhood;
  return query select
    private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.pun_format'),
                                   'BN-{district}-{neighbourhood}-{serial:6}'), v_dcode, v_ncode, v_serial),
    private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'),
                                   '{district}{serial:7}'), v_dcode, v_ncode, v_account);
end;
$$;

/** Registrar's final decision: register the parcel, generate PUN + account number, record owners. */
create or replace function public.application_register(p_id uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_parcel public.parcels;
  v_ids record;
begin
  perform private.assert_permission('parcels.approve');
  perform public.close_due_notices();
  select * into v from public.applications where id = p_id for update;
  if v is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status = 'public_notice' then
    perform private.raise_app_error('CONFLICT', 'notice_running');
  end if;
  if v.status <> 'in_verification' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if v.verified_by = auth.uid() then
    perform private.raise_app_error('MAKER_CHECKER', 'verifier');
  end if;
  if exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id
             where n.application_id = p_id and o.status in ('open', 'upheld')) then
    perform private.raise_app_error('CONFLICT', 'open_objection');
  end if;
  select * into v_parcel from public.parcels where id = v.parcel_id for update;
  if v_parcel.id is null or v_parcel.status <> 'verified' then
    perform private.raise_app_error('CONFLICT', 'parcel_not_verified');
  end if;

  select * into v_ids from private.next_pun(v_parcel.district_id, v_parcel.neighbourhood_id);
  update public.parcels
     set pun = v_ids.pun, account_no = v_ids.account_no, status = 'registered', registered_at = now(),
         registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v_parcel.id;

  insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
  select v_parcel.id, ap.party_id, ap.role, ap.share_pct, p_id
  from public.application_parties ap
  where ap.application_id = p_id and ap.role in ('owner', 'co_owner', 'heir');

  update public.applications set status = 'approved', decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  perform private.parcel_event(v_parcel.id, 'registered', p_note, jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no));
  perform private.application_event(p_id, 'registered', 'in_verification', 'approved', v_ids.pun);
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'parcel.registered',
      'Dhulkaaga waa la diiwaangeliyay: ' || v_ids.pun, 'Your parcel is registered: ' || v_ids.pun,
      '/portal/applications/' || p_id);
  end if;
  insert into public.jobs (kind, payload, created_by)
  values ('sms.parcel_registered', jsonb_build_object('application_id', p_id, 'parcel_id', v_parcel.id, 'pun', v_ids.pun), auth.uid());
  return jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'parcel_id', v_parcel.id);
end;
$$;

-- Resubmitting after "returned" goes back to where the application was, not to the fee step.
create or replace function public.application_submit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
  v_problems jsonb := public.application_checklist(p_id);
  v_to public.application_status;
begin
  if jsonb_array_length(v_problems) > 0 then
    perform private.raise_app_error('VALIDATION', 'checklist');
  end if;
  v_to := case
    when v.fee_status = 'due' then 'awaiting_payment'
    when exists (select 1 from public.surveys where application_id = p_id and status = 'submitted') then 'surveyed'
    else 'in_survey' end;
  update public.applications
     set status = v_to, submitted_at = coalesce(submitted_at, now()), decision_note = null
   where id = p_id;
  perform private.application_event(p_id, case when v.status = 'returned' then 'resubmitted' else 'submitted' end,
                                    v.status, v_to, null);
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'application.submitted',
      'Codsigaaga ' || v.number || ' waa la gudbiyay', 'Your application ' || v.number || ' was submitted',
      '/portal/applications/' || p_id);
  end if;
  insert into public.jobs (kind, payload, created_by)
  values ('sms.application_submitted', jsonb_build_object('application_id', p_id, 'number', v.number), auth.uid());
  return jsonb_build_object('number', v.number, 'status', v_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- Map tiles for parcels (staff only: requires map.view and district access)
-- ---------------------------------------------------------------------------
create or replace function public.parcel_tile(p_z int, p_x int, p_y int)
returns bytea
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v bytea;
  v_all boolean;
  v_districts uuid[];
begin
  if p_z < 13 or p_z > 22 or not public.has_permission('map.view') then
    return ''::bytea;
  end if;
  v_all := private.user_has_all_districts(auth.uid());
  v_districts := private.user_district_ids(auth.uid());
  select st_asmvt(t.*, 'parcels') into v from (
    select st_asmvtgeom(st_transform(p.geom, 3857), v_env) as geom, p.id::text as id, p.pun, p.status::text as status,
           p.land_use::text as land_use, p.area_m2::float8 as area_m2, p.application_id::text as application_id
    from public.parcels p
    where p.deleted_at is null and p.status <> 'archived'
      and p.geom && st_transform(v_env, 4326)
      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea);
end;
$$;

/** PUN / owner search for staff (RLS applies through can_view_parcel). */
create or replace function public.search_parcels(p_q text, p_limit int default 20)
returns table (id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
          where po.parcel_id = p.id and po.valid_to is null)
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  where p.deleted_at is null
    and (coalesce(trim(p_q), '') = ''
         or p.pun ilike '%' || trim(p_q) || '%'
         or p.account_no ilike trim(p_q) || '%'
         or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                    where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%'))
  order by p.registered_at desc nulls last, p.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

/** Survey work queue counts (surveys page tabs). */
create or replace function public.survey_status_counts()
returns table (status public.survey_status, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select status, count(*) from public.surveys group by status;
$$;

-- ---------------------------------------------------------------------------
-- Storage for survey photos (server-side access only, like application documents)
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('survey-photos', 'survey-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

-- Daily: close ended public notices (pg_cron when available).
do $$
begin
  perform cron.schedule('close-due-notices', '15 0 * * *', 'select public.close_due_notices()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  private.user_has_permission(uuid, text), private.user_can_access_district(uuid, uuid),
  private.parcel_event(uuid, text, text, jsonb), private.survey_polygon(jsonb), private.parcel_overlaps(extensions.geometry, uuid),
  private.format_serial(text, text, text, int), private.can_view_parcel(uuid), private.can_view_survey(uuid),
  private.application_fee_settled(uuid, public.fee_status, text), private.assert_surveyor(uuid),
  private.survey_to_parcel(public.surveys, public.parcel_status), private.next_pun(uuid, uuid),
  public.application_waive_fee(uuid, text), public.survey_candidates(uuid), public.survey_assign(uuid, uuid, date),
  public.survey_save(uuid, jsonb), public.survey_add_photo(uuid, text, double precision, double precision, timestamptz, text),
  public.survey_photo_path(uuid), public.survey_submit(uuid), public.survey_gis_review(uuid, text, text, jsonb),
  public.application_verify(uuid, jsonb, text), public.close_due_notices(),
  public.objection_file(uuid, text, text, text), public.objection_resolve(uuid, public.objection_status, text),
  public.public_notices_active(), public.application_register(uuid, public.land_use, text),
  public.parcel_tile(int, int, int), public.search_parcels(text, int), public.survey_status_counts()
from public, anon, authenticated;

-- RLS helpers run as the querying user.
grant execute on function private.can_view_parcel(uuid), private.can_view_survey(uuid) to authenticated;

grant execute on function
  public.application_waive_fee(uuid, text), public.survey_candidates(uuid), public.survey_assign(uuid, uuid, date),
  public.survey_save(uuid, jsonb), public.survey_add_photo(uuid, text, double precision, double precision, timestamptz, text),
  public.survey_photo_path(uuid), public.survey_submit(uuid), public.survey_gis_review(uuid, text, text, jsonb),
  public.application_verify(uuid, jsonb, text), public.objection_file(uuid, text, text, text),
  public.objection_resolve(uuid, public.objection_status, text), public.application_register(uuid, public.land_use, text),
  public.parcel_tile(int, int, int), public.search_parcels(text, int), public.survey_status_counts()
to authenticated;

grant execute on function public.public_notices_active() to anon, authenticated;
grant execute on function public.close_due_notices() to service_role;
