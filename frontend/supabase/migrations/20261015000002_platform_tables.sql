-- ============================================================================
-- 0002 Platform tables: geography base, profiles, RBAC, settings, jobs, audit
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Geography base. Phase 2 adds sections, sectors, neighbourhoods and streets.
-- Districts are needed now because staff are scoped to districts.
-- ---------------------------------------------------------------------------
create table public.regions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name_so     text not null,
  name_en     text not null,
  geom        extensions.geometry(MultiPolygon, 4326),
  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  deleted_at  timestamptz
);

create table public.districts (
  id               uuid primary key default gen_random_uuid(),
  region_id        uuid not null references public.regions (id),
  code             text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name_so          text not null,
  name_en          text not null,
  -- Optional on purpose: the old system blocked district creation on an empty
  -- "Branch Manager" list. A manager can be linked later.
  manager_user_id  uuid references auth.users (id) on delete set null,
  geom             extensions.geometry(MultiPolygon, 4326),
  legacy_id        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz
);
create index districts_region_idx on public.districts (region_id);
create index districts_name_trgm on public.districts using gin (name_so extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Profiles: one per auth user (staff and citizens).
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  kind                    public.user_kind not null default 'citizen',
  full_name               text not null default '',
  email                   text,
  phone                   text,
  status                  public.user_status not null default 'active',
  must_change_password    boolean not null default false,
  locale                  text not null default 'so' check (locale in ('so', 'en')),
  -- Staff with this flag see all districts (still limited by their roles' data scope).
  all_districts           boolean not null default false,
  last_login_at           timestamptz,
  -- Access tokens issued before this instant are rejected by has_permission().
  sessions_revoked_at     timestamptz,
  -- Bumped whenever the user's roles/districts/permissions change; middleware refreshes
  -- the JWT when its `iat` is older so claims are never stale.
  permissions_changed_at  timestamptz not null default now(),
  point_of_sale_id        uuid, -- FK added in Phase 7 (points_of_sale)
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id) on delete set null,
  deleted_at              timestamptz
);
create unique index profiles_email_key on public.profiles (lower(email)) where email is not null;
create index profiles_phone_idx on public.profiles (phone);
create index profiles_status_idx on public.profiles (status);
create index profiles_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- RBAC: roles are data. Permissions are a fixed catalog (see 0003).
-- ---------------------------------------------------------------------------
create table public.permissions (
  key             text primary key check (key ~ '^[a-z_]+\.[a-z_0-9]+$'),
  module          text not null,
  action          text not null,
  is_special      boolean not null default false,
  description_so  text not null default '',
  description_en  text not null default '',
  sort            int not null default 0
);

create table public.roles (
  id                   uuid primary key default gen_random_uuid(),
  -- Stable key for seeded system roles ('super_admin', 'cashier', …); null for custom roles.
  key                  text unique check (key ~ '^[a-z_]+$'),
  name_so              text not null,
  name_en              text not null,
  description          text not null default '',
  colour               text not null default '#64748B' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  is_system            boolean not null default false,
  is_protected         boolean not null default false,
  grants_all           boolean not null default false,
  data_scope           public.data_scope not null default 'district',
  -- e.g. {"maxWaiverAmount": 500, "maxRefundAmount": 100}
  limits               jsonb not null default '{}'::jsonb,
  -- Permissions a system role ships with, for "Reset to default".
  default_permissions  text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  constraint protected_roles_are_system check (not is_protected or is_system),
  constraint grants_all_only_protected check (not grants_all or is_protected)
);
create unique index roles_name_en_key on public.roles (lower(name_en));
create unique index roles_name_so_key on public.roles (lower(name_so));

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);
create index role_permissions_perm_idx on public.role_permissions (permission_key);

create table public.user_roles (
  user_id      uuid not null references public.profiles (user_id) on delete cascade,
  role_id      uuid not null references public.roles (id) on delete restrict,
  assigned_by  uuid references auth.users (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles (role_id);

create table public.user_districts (
  user_id      uuid not null references public.profiles (user_id) on delete cascade,
  district_id  uuid not null references public.districts (id) on delete cascade,
  assigned_by  uuid references auth.users (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (user_id, district_id)
);
create index user_districts_district_idx on public.user_districts (district_id);

-- ---------------------------------------------------------------------------
-- Login events (success and failure) — also drive the 5-attempt / 15-minute lockout.
-- ---------------------------------------------------------------------------
create table public.login_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  method      text not null default 'password', -- password | google | otp | mfa
  success     boolean not null,
  reason      text,
  ip          text,
  user_agent  text,
  at          timestamptz not null default now()
);
create index login_events_email_at_idx on public.login_events (lower(email), at desc);
create index login_events_user_at_idx on public.login_events (user_id, at desc);

-- ---------------------------------------------------------------------------
-- Typed settings (value is jsonb; `is_public` settings are readable without login).
-- ---------------------------------------------------------------------------
create table public.settings (
  key          text primary key check (key ~ '^[a-z_]+(\.[a-z_0-9]+)+$'),
  value        jsonb not null,
  is_public    boolean not null default false,
  is_secret    boolean not null default false,
  description  text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Background jobs queue (worked by Edge Functions / pg_cron).
-- ---------------------------------------------------------------------------
create table public.jobs (
  id          bigint generated always as identity primary key,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      public.job_status not null default 'queued',
  attempts    int not null default 0,
  max_attempts int not null default 5,
  run_after   timestamptz not null default now(),
  last_error  text,
  dedupe_key  text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);
create index jobs_pick_idx on public.jobs (status, run_after) where status = 'queued';

-- ---------------------------------------------------------------------------
-- In-app notifications.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  title_so    text not null,
  title_en    text not null,
  body_so     text not null default '',
  body_en     text not null default '',
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Idempotency keys: every create action carries a client key so a double click or a
-- retried request returns the first result instead of creating a duplicate.
-- ---------------------------------------------------------------------------
create table public.idempotency_keys (
  key         uuid primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  action      text not null,
  status      text not null default 'pending' check (status in ('pending', 'done')),
  result      jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only; see 0006).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,              -- no FK: history outlives users
  actor_email text,
  action      text not null,     -- insert | update | delete | user.create | role.permissions_update …
  table_name  text,
  record_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  user_agent  text,
  request_id  text
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.regions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.districts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Default settings
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, is_public, description) values
  ('app.name', '{"so": "Dhulka — Gobolka Banaadir", "en": "Dhulka — Banadir Regional Administration"}', true, 'Application name'),
  ('security.staff_mfa_required', 'true', false, 'Staff must use TOTP 2FA (aal2) for any permission'),
  ('security.session_timeout_minutes', '30', false, 'Idle timeout for staff sessions'),
  ('security.lockout_max_attempts', '5', false, 'Failed logins before lockout'),
  ('security.lockout_minutes', '15', false, 'Lockout duration'),
  ('registration.pun_format', '"BN-{district}-{neighbourhood}-{serial:6}"', false, 'PUN format (Phase 4)'),
  ('registration.public_notice_days', '14', false, 'Public notice period in days (Phase 4)'),
  ('certificates.require_full_payment', 'true', false, 'Certificate only when no overdue balance (Phase 8)');
