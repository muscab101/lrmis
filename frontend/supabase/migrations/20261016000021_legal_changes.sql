-- ============================================================================
-- 0021 Phase 9 — Transfers, subdivision / merge, change of use, building permits, liens,
-- leases, disputes and court orders (§4.10).
--   Blockers (private.parcel_blockers): open dispute, active freeze order, active lien
--   (transfers and subdivision only), unpaid balance, a pending change on the parcel.
--   Every change is requested by one person and decided by another; approval re-checks
--   the blockers. Ownership and geometry changes cancel the parcel's valid certificate
--   and ID cards so new ones are issued from the updated register.
-- ============================================================================

create type public.transfer_kind as enum ('sale', 'gift', 'inheritance', 'court_order');
create type public.request_status as enum ('draft', 'submitted', 'approved', 'rejected', 'cancelled');
create type public.change_kind as enum ('subdivide', 'merge', 'change_of_use');
create type public.dispute_kind as enum ('boundary', 'ownership', 'inheritance', 'other');
create type public.dispute_status as enum ('open', 'resolved', 'dismissed');
create type public.court_order_kind as enum ('freeze', 'transfer', 'release', 'other');
create type public.lien_kind as enum ('mortgage', 'lien', 'caveat');
create type public.permit_kind as enum ('construction', 'extension', 'renovation', 'demolition', 'fence');
create type public.lease_status as enum ('active', 'ended', 'terminated');

insert into public.settings (key, value, description) values
  ('transfers.stamp_duty_pct', '2', 'Stamp duty on sales and gifts, % of the declared value'),
  ('transfers.stamp_duty_min', '10', 'Minimum stamp duty (USD)'),
  ('transfers.inheritance_duty', '0', 'Flat duty on inheritance transfers (USD; 0 = none)'),
  ('changes.subdivision_tolerance_pct', '1', 'How far (%) the children''s total area may differ from the parent'),
  ('permits.valid_months', '12', 'How long an approved building permit is valid')
on conflict (key) do nothing;

insert into public.fee_types (code, name_so, name_en, interval, amount, sort) values
  ('building_permit', 'Ruqsadda dhismaha', 'Building permit', 'one_off', 50, 60)
on conflict (code) do nothing;

-- Front desk opens transfers; nothing else in the catalogue did.
update public.roles set default_permissions = default_permissions || array['transfers.view', 'transfers.create']
 where key = 'front_desk_clerk' and not ('transfers.create' = any (default_permissions));
insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r cross join unnest(array['transfers.view', 'transfers.create']) p where r.key = 'front_desk_clerk'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.disputes (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  parcel_id           uuid not null references public.parcels (id),
  district_id         uuid not null references public.districts (id),
  kind                public.dispute_kind not null,
  description         text not null check (length(trim(description)) >= 10),
  claimant_name       text not null check (length(trim(claimant_name)) >= 2),
  claimant_phone      text,
  court_case_no       text,
  status              public.dispute_status not null default 'open',
  opened_by           uuid references auth.users (id) on delete set null,
  opened_at           timestamptz not null default now(),
  resolved_by         uuid references auth.users (id) on delete set null,
  resolved_at         timestamptz,
  resolution          text
);
create index disputes_parcel_idx on public.disputes (parcel_id, status);

create table public.court_orders (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    uuid not null references public.parcels (id),
  district_id  uuid not null references public.districts (id),
  dispute_id   uuid references public.disputes (id),
  order_no     text not null,
  court        text not null,
  order_date   date not null,
  kind         public.court_order_kind not null,
  description  text not null,
  active       boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  lifted_by    uuid references auth.users (id) on delete set null,
  lifted_at    timestamptz,
  lift_note    text
);
create index court_orders_parcel_idx on public.court_orders (parcel_id) where active;

create table public.liens (
  id             uuid primary key default gen_random_uuid(),
  parcel_id      uuid not null references public.parcels (id),
  district_id    uuid not null references public.districts (id),
  kind           public.lien_kind not null,
  holder         text not null check (length(trim(holder)) >= 2),
  amount         numeric(14, 2),
  reference      text,
  active         boolean not null default true,
  registered_by  uuid references auth.users (id) on delete set null,
  registered_at  timestamptz not null default now(),
  released_by    uuid references auth.users (id) on delete set null,
  released_at    timestamptz,
  release_note   text
);
create index liens_parcel_idx on public.liens (parcel_id) where active;

create table public.transfers (
  id                   uuid primary key default gen_random_uuid(),
  number               text not null unique,
  parcel_id            uuid not null references public.parcels (id),
  district_id          uuid not null references public.districts (id),
  kind                 public.transfer_kind not null,
  declared_value       numeric(14, 2) check (declared_value is null or declared_value >= 0),
  court_order_id       uuid references public.court_orders (id),
  from_owners          jsonb not null,
  to_owners            jsonb not null default '[]'::jsonb,
  status               public.request_status not null default 'draft',
  duty_invoice_id      uuid references public.invoices (id),
  note                 text,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  submitted_at         timestamptz,
  decided_by           uuid references auth.users (id) on delete set null,
  decided_at           timestamptz,
  decision_note        text
);
create unique index transfers_open_uidx on public.transfers (parcel_id) where status in ('draft', 'submitted');

create table public.parcel_changes (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,
  kind               public.change_kind not null,
  parcel_ids         uuid[] not null check (cardinality(parcel_ids) >= 1),
  district_id        uuid not null references public.districts (id),
  payload            jsonb not null default '{}'::jsonb,
  reason             text not null check (length(trim(reason)) >= 5),
  status             public.request_status not null default 'submitted',
  requested_by       uuid references auth.users (id) on delete set null,
  requested_at       timestamptz not null default now(),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  result_parcel_ids  uuid[] not null default '{}'
);

create table public.permits (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  parcel_id        uuid not null references public.parcels (id),
  district_id      uuid not null references public.districts (id),
  kind             public.permit_kind not null,
  description      text not null check (length(trim(description)) >= 10),
  floors           int check (floors is null or floors between 0 and 60),
  area_m2          numeric(10, 2) check (area_m2 is null or area_m2 > 0),
  applicant_name   text not null,
  applicant_phone  text,
  status           public.request_status not null default 'submitted',
  fee_invoice_id   uuid references public.invoices (id),
  conditions       text,
  valid_until      date,
  requested_by     uuid references auth.users (id) on delete set null,
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text
);

create table public.leases (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  parcel_id        uuid not null references public.parcels (id),
  district_id      uuid not null references public.districts (id),
  lessee_party_id  uuid not null references public.parties (id),
  start_date       date not null,
  end_date         date not null,
  annual_rent      numeric(14, 2) not null check (annual_rent >= 0),
  purpose          text,
  status           public.lease_status not null default 'active',
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  ended_by         uuid references auth.users (id) on delete set null,
  ended_at         timestamptz,
  end_note         text,
  check (end_date > start_date)
);
create unique index leases_active_uidx on public.leases (parcel_id) where status = 'active';

do $$
declare t text;
begin
  foreach t in array array['disputes', 'court_orders', 'liens', 'transfers', 'parcel_changes', 'permits', 'leases'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t,
      case when t = 'parcel_changes' then 'exists (select 1 from unnest(parcel_ids) pid where private.can_view_parcel(pid))'
           else 'private.can_view_parcel(parcel_id)' end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** What stops a change to the parcel. p_purpose: transfer | subdivide | merge | change_of_use | permit | lease. */
create or replace function private.parcel_blockers(p_parcel uuid, p_purpose text, p_ignore_change uuid default null)
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
  if v.status = 'archived' or v.deleted_at is not null then
    return array['archived'];
  end if;
  if v.status not in ('registered', 'disputed') then
    v_out := array_append(v_out, 'not_registered');
  end if;
  if exists (select 1 from public.disputes where parcel_id = p_parcel and status = 'open') then
    v_out := array_append(v_out, 'dispute');
  end if;
  if exists (select 1 from public.court_orders where parcel_id = p_parcel and active and kind = 'freeze') then
    v_out := array_append(v_out, 'freeze_order');
  end if;
  if p_purpose in ('transfer', 'subdivide', 'merge') and exists (select 1 from public.liens where parcel_id = p_parcel and active) then
    v_out := array_append(v_out, 'lien');
  end if;
  if p_purpose in ('transfer', 'subdivide', 'merge')
     and exists (select 1 from public.invoices where parcel_id = p_parcel and status in ('issued', 'partially_paid') and balance > 0
                 and (p_purpose <> 'transfer' or fee_type_id <> (select id from public.fee_types where code = 'transfer_stamp_duty'))) then
    v_out := array_append(v_out, 'unpaid');
  end if;
  if exists (select 1 from public.parcel_changes where p_parcel = any (parcel_ids) and status = 'submitted' and id is distinct from p_ignore_change) then
    v_out := array_append(v_out, 'pending_change');
  end if;
  return v_out;
end;
$$;

create or replace function private.assert_no_blockers(p_parcel uuid, p_purpose text, p_ignore_change uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := private.parcel_blockers(p_parcel, p_purpose, p_ignore_change);
begin
  if cardinality(v) > 0 then
    perform private.raise_app_error('CONFLICT', 'blocked:' || array_to_string(v, ','));
  end if;
end;
$$;

create or replace function private.scoped_parcel(p_parcel uuid)
returns public.parcels
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return v;
end;
$$;

/** Valid certificates and ID cards no longer describe the parcel after an ownership or geometry change. */
create or replace function private.cancel_parcel_documents(p_parcel uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.issued_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
   where parcel_id = p_parcel and status = 'valid';
$$;

/** A one-off fee invoice raised by the system (stamp duty, permit fee). */
create or replace function private.raise_fee_invoice(p_parcel uuid, p_fee_code text, p_amount numeric, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_fee uuid;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;
  select * into v_p from public.parcels where id = p_parcel;
  select id into v_fee from public.fee_types where code = p_fee_code;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), p_parcel, v_p.district_id, v_fee,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-' || p_fee_code || '-' || p_parcel),
          current_date, current_date + 30, round(p_amount, 2), p_description, auth.uid())
  returning id into v_id;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by) values (v_id, 'fee', p_description, round(p_amount, 2), auth.uid());
  return v_id;
end;
$$;

create or replace function private.serial(p_prefix text)
returns text
language sql
security definer
set search_path = ''
as $$
  select p_prefix || '-' || extract(year from current_date)::int || '-' || lpad(private.next_serial(p_prefix || '-' || extract(year from current_date)::int)::text, 5, '0');
$$;

/** Recompute the parcel's status after legal records change (disputed ↔ registered). */
create or replace function private.refresh_parcel_status(p_parcel uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.parcels p
     set status = case when exists (select 1 from public.disputes d where d.parcel_id = p.id and d.status = 'open')
                         or exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id where n.parcel_id = p.id and o.status = 'upheld')
                       then 'disputed'::public.parcel_status else 'registered'::public.parcel_status end
   where p.id = p_parcel and p.status in ('registered', 'disputed');
$$;

-- ---------------------------------------------------------------------------
-- Disputes, court orders, liens (legal officers)
-- ---------------------------------------------------------------------------
create or replace function public.dispute_open(p_parcel uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('disputes.create');
  v := private.scoped_parcel(p_parcel);
  insert into public.disputes (number, parcel_id, district_id, kind, description, claimant_name, claimant_phone, court_case_no, opened_by)
  values (private.serial('DSP'), p_parcel, v.district_id, (p ->> 'kind')::public.dispute_kind, trim(p ->> 'description'), trim(p ->> 'claimant_name'),
          nullif(trim(p ->> 'claimant_phone'), ''), nullif(trim(p ->> 'court_case_no'), ''), auth.uid())
  returning id into v_id;
  perform private.refresh_parcel_status(p_parcel);
  perform private.parcel_event(p_parcel, 'dispute_opened', p ->> 'description', jsonb_build_object('dispute_id', v_id));
  return v_id;
exception when check_violation then
  perform private.raise_app_error('VALIDATION', 'dispute');
end;
$$;

create or replace function public.dispute_close(p_id uuid, p_status public.dispute_status, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.disputes;
begin
  perform private.assert_permission('disputes.approve');
  select * into v from public.disputes where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'dispute');
  end if;
  if v.status <> 'open' or p_status = 'open' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.opened_by);
  if length(trim(coalesce(p_resolution, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.disputes set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution = trim(p_resolution) where id = p_id;
  perform private.refresh_parcel_status(v.parcel_id);
  perform private.parcel_event(v.parcel_id, 'dispute_' || p_status::text, p_resolution, jsonb_build_object('dispute_id', p_id));
end;
$$;

create or replace function public.court_order_add(p_parcel uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('disputes.create');
  v := private.scoped_parcel(p_parcel);
  if coalesce(trim(p ->> 'order_no'), '') = '' or coalesce(trim(p ->> 'court'), '') = '' or coalesce(trim(p ->> 'description'), '') = '' then
    perform private.raise_app_error('VALIDATION', 'court_order');
  end if;
  insert into public.court_orders (parcel_id, district_id, dispute_id, order_no, court, order_date, kind, description, created_by)
  values (p_parcel, v.district_id, nullif(p ->> 'dispute_id', '')::uuid, trim(p ->> 'order_no'), trim(p ->> 'court'), (p ->> 'order_date')::date,
          (p ->> 'kind')::public.court_order_kind, trim(p ->> 'description'), auth.uid())
  returning id into v_id;
  perform private.parcel_event(p_parcel, 'court_order_added', p ->> 'description', jsonb_build_object('court_order_id', v_id, 'kind', p ->> 'kind'));
  return v_id;
end;
$$;

create or replace function public.court_order_lift(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.court_orders;
begin
  perform private.assert_permission('disputes.approve');
  select * into v from public.court_orders where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'court_order');
  end if;
  if not v.active then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if length(trim(coalesce(p_note, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.court_orders set active = false, lifted_by = auth.uid(), lifted_at = now(), lift_note = trim(p_note) where id = p_id;
  perform private.parcel_event(v.parcel_id, 'court_order_lifted', p_note, jsonb_build_object('court_order_id', p_id));
end;
$$;

create or replace function public.lien_register(p_parcel uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('disputes.create');
  v := private.scoped_parcel(p_parcel);
  if length(trim(coalesce(p ->> 'holder', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'holder');
  end if;
  insert into public.liens (parcel_id, district_id, kind, holder, amount, reference, registered_by)
  values (p_parcel, v.district_id, (p ->> 'kind')::public.lien_kind, trim(p ->> 'holder'), nullif(p ->> 'amount', '')::numeric, nullif(trim(p ->> 'reference'), ''), auth.uid())
  returning id into v_id;
  perform private.parcel_event(p_parcel, 'lien_registered', p ->> 'holder', jsonb_build_object('lien_id', v_id, 'kind', p ->> 'kind'));
  return v_id;
end;
$$;

create or replace function public.lien_release(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.liens;
begin
  perform private.assert_permission('disputes.approve');
  select * into v from public.liens where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'lien');
  end if;
  if not v.active then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.registered_by);
  if length(trim(coalesce(p_note, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.liens set active = false, released_by = auth.uid(), released_at = now(), release_note = trim(p_note) where id = p_id;
  perform private.parcel_event(v.parcel_id, 'lien_released', p_note, jsonb_build_object('lien_id', p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
create or replace function public.transfer_create(p_parcel uuid, p_kind public.transfer_kind, p_value numeric, p_court_order uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('transfers.create');
  v := private.scoped_parcel(p_parcel);
  if p_kind in ('sale', 'gift') and (p_value is null or p_value <= 0) then
    perform private.raise_app_error('VALIDATION', 'declared_value');
  end if;
  if p_kind = 'court_order' and not exists (select 1 from public.court_orders where id = p_court_order and parcel_id = p_parcel and active and kind = 'transfer') then
    perform private.raise_app_error('VALIDATION', 'court_order');
  end if;
  insert into public.transfers (number, parcel_id, district_id, kind, declared_value, court_order_id, from_owners, note, created_by)
  values (private.serial('TRF'), p_parcel, v.district_id, p_kind, p_value, p_court_order,
          coalesce((select jsonb_agg(jsonb_build_object('party_id', po.party_id, 'full_name', pa.full_name, 'role', po.role, 'share_pct', po.share_pct))
                    from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = p_parcel and po.valid_to is null), '[]'::jsonb),
          nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'transfer_open');
end;
$$;

/** p_owners: [{party_id, role (owner|co_owner|heir), share_pct}] — shares must total 100. */
create or replace function public.transfer_set_recipients(p_id uuid, p_owners jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
  v_total numeric;
begin
  perform private.assert_permission('transfers.create');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if jsonb_typeof(p_owners) <> 'array' or jsonb_array_length(p_owners) = 0
     or exists (select 1 from jsonb_array_elements(p_owners) o where not exists (select 1 from public.parties pa where pa.id = (o ->> 'party_id')::uuid and pa.deleted_at is null))
     or exists (select 1 from jsonb_array_elements(p_owners) o where (o ->> 'role') not in ('owner', 'co_owner', 'heir')) then
    perform private.raise_app_error('VALIDATION', 'recipients');
  end if;
  select sum((o ->> 'share_pct')::numeric) into v_total from jsonb_array_elements(p_owners) o;
  if v_total is null or abs(v_total - 100) > 0.01 then
    perform private.raise_app_error('VALIDATION', 'shares_total');
  end if;
  update public.transfers
     set to_owners = (select jsonb_agg(jsonb_build_object('party_id', pa.id, 'full_name', pa.full_name, 'role', o ->> 'role', 'share_pct', round((o ->> 'share_pct')::numeric, 2)))
                      from jsonb_array_elements(p_owners) o join public.parties pa on pa.id = (o ->> 'party_id')::uuid)
   where id = p_id;
end;
$$;

/** Submit: blockers checked, stamp duty invoice raised (sale / gift / inheritance flat duty). */
create or replace function public.transfer_submit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
  v_duty numeric := 0;
  v_inv uuid;
begin
  perform private.assert_permission('transfers.create');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if jsonb_array_length(v.to_owners) = 0 then
    perform private.raise_app_error('VALIDATION', 'recipients');
  end if;
  perform private.assert_no_blockers(v.parcel_id, 'transfer');
  if v.kind in ('sale', 'gift') then
    v_duty := greatest(round(v.declared_value * private.setting_numeric('transfers.stamp_duty_pct', 2) / 100, 2), private.setting_numeric('transfers.stamp_duty_min', 10));
  elsif v.kind = 'inheritance' then
    v_duty := private.setting_numeric('transfers.inheritance_duty', 0);
  end if;
  v_inv := private.raise_fee_invoice(v.parcel_id, 'transfer_stamp_duty', v_duty, 'Stamp duty — ' || v.number);
  update public.transfers set status = 'submitted', submitted_at = now(), duty_invoice_id = v_inv where id = p_id;
  perform private.parcel_event(v.parcel_id, 'transfer_submitted', null, jsonb_build_object('transfer_id', p_id, 'kind', v.kind));
  return jsonb_build_object('duty', v_duty, 'invoice_id', v_inv);
end;
$$;

/** Registrar decides. Approval: duty paid, blockers re-checked, owners replaced, documents cancelled. */
create or replace function public.transfer_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
  r jsonb;
  v_user uuid;
begin
  perform private.assert_permission('transfers.approve');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.transfers set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    update public.invoices set status = 'cancelled', cancel_reason = 'Transfer rejected' where id = v.duty_invoice_id and paid = 0 and status <> 'cancelled';
    perform private.parcel_event(v.parcel_id, 'transfer_rejected', p_note, jsonb_build_object('transfer_id', p_id));
    return;
  end if;
  if v.duty_invoice_id is not null and exists (select 1 from public.invoices where id = v.duty_invoice_id and status <> 'paid') then
    perform private.raise_app_error('CONFLICT', 'duty_unpaid');
  end if;
  perform private.assert_no_blockers(v.parcel_id, 'transfer');

  update public.parcel_owners set valid_to = current_date where parcel_id = v.parcel_id and valid_to is null;
  for r in select * from jsonb_array_elements(v.to_owners) loop
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
    values (v.parcel_id, (r ->> 'party_id')::uuid, (r ->> 'role')::public.application_party_role, (r ->> 'share_pct')::numeric, null);
  end loop;
  perform private.cancel_parcel_documents(v.parcel_id, 'Ownership transferred: ' || v.number);
  update public.transfers set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  perform private.parcel_event(v.parcel_id, 'transferred', p_note, jsonb_build_object('transfer_id', p_id, 'from', v.from_owners, 'to', v.to_owners));
  for v_user in select distinct pa.citizen_user_id from jsonb_array_elements(v.to_owners) o join public.parties pa on pa.id = (o ->> 'party_id')::uuid
                where pa.citizen_user_id is not null loop
    perform private.notify(v_user, 'transfer.approved', 'Wareejinta ' || v.number || ' waa la ansixiyay', 'Transfer ' || v.number || ' was approved', '/portal');
  end loop;
end;
$$;

create or replace function public.transfer_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
begin
  perform private.assert_permission('transfers.create');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status not in ('draft', 'submitted') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_reason) where id = p_id;
  update public.invoices set status = 'cancelled', cancel_reason = 'Transfer cancelled' where id = v.duty_invoice_id and paid = 0 and status <> 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Parcel changes: subdivide, merge, change of use
-- ---------------------------------------------------------------------------
create or replace function private.validate_subdivision(p_parent uuid, p_children jsonb)
returns void
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_parent geometry;
  v_parent_area numeric;
  v_sum numeric := 0;
  v_geoms geometry[] := '{}';
  c jsonb;
  g geometry;
  v_tol numeric := private.setting_numeric('changes.subdivision_tolerance_pct', 1);
begin
  select geom into v_parent from public.parcels where id = p_parent;
  v_parent_area := st_area(v_parent::geography);
  if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) < 2 or jsonb_array_length(p_children) > 50 then
    perform private.raise_app_error('VALIDATION', 'children');
  end if;
  for c in select * from jsonb_array_elements(p_children) loop
    begin
      g := st_setsrid(st_geomfromgeojson(c::text), 4326);
    exception when others then
      perform private.raise_app_error('VALIDATION', 'children');
    end;
    if geometrytype(g) <> 'POLYGON' or not st_isvalid(g) then
      perform private.raise_app_error('VALIDATION', 'child_invalid');
    end if;
    -- Inside the parent (0.5 m slack for digitising).
    if not st_covers(st_buffer(v_parent::geography, 0.5)::geometry, g) then
      perform private.raise_app_error('VALIDATION', 'child_outside');
    end if;
    if exists (select 1 from unnest(v_geoms) o where st_area(st_intersection(o, g)::geography) > 0.5) then
      perform private.raise_app_error('VALIDATION', 'children_overlap');
    end if;
    v_geoms := v_geoms || g;
    v_sum := v_sum + st_area(g::geography);
  end loop;
  if abs(v_sum - v_parent_area) / v_parent_area * 100 > v_tol then
    perform private.raise_app_error('VALIDATION', 'children_area');
  end if;
end;
$$;

create or replace function public.parcel_change_request(p_kind public.change_kind, p_parcels uuid[], p_payload jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.parcels;
  v_id uuid;
  pid uuid;
  v_first uuid := p_parcels[1];
begin
  perform private.assert_permission('parcels.update');
  if p_parcels is null or cardinality(p_parcels) = 0 then
    perform private.raise_app_error('VALIDATION', 'parcels');
  end if;
  foreach pid in array p_parcels loop
    v := private.scoped_parcel(pid);
    perform private.assert_no_blockers(pid, p_kind::text);
  end loop;
  select * into v from public.parcels where id = v_first;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;

  if p_kind = 'subdivide' then
    if cardinality(p_parcels) <> 1 then
      perform private.raise_app_error('VALIDATION', 'parcels');
    end if;
    perform private.validate_subdivision(v_first, p_payload -> 'children');
  elsif p_kind = 'merge' then
    if cardinality(p_parcels) < 2 or cardinality(p_parcels) > 10 then
      perform private.raise_app_error('VALIDATION', 'parcels');
    end if;
    if (select count(distinct neighbourhood_id) from public.parcels where id = any (p_parcels)) > 1 then
      perform private.raise_app_error('VALIDATION', 'merge_neighbourhood');
    end if;
    -- Same owners with the same shares on every parcel.
    if (select count(distinct x) from (
          select string_agg(po.party_id::text || ':' || coalesce(po.share_pct, 0)::text, ',' order by po.party_id) x
          from unnest(p_parcels) q(id) join public.parcel_owners po on po.parcel_id = q.id and po.valid_to is null group by q.id) s) <> 1 then
      perform private.raise_app_error('VALIDATION', 'merge_owners');
    end if;
    if geometrytype(st_union(array(select st_snap(geom, (select st_collect(geom) from public.parcels where id = any (p_parcels)), 0.000005) from public.parcels where id = any (p_parcels)))) <> 'POLYGON' then
      perform private.raise_app_error('VALIDATION', 'merge_not_touching');
    end if;
  elsif p_kind = 'change_of_use' then
    if cardinality(p_parcels) <> 1 or (p_payload ->> 'land_use') is null or (p_payload ->> 'land_use')::public.land_use = v.land_use then
      perform private.raise_app_error('VALIDATION', 'land_use');
    end if;
  end if;

  insert into public.parcel_changes (number, kind, parcel_ids, district_id, payload, reason, requested_by)
  values (private.serial('PCH'), p_kind, p_parcels, v.district_id, coalesce(p_payload, '{}'::jsonb), trim(p_reason), auth.uid())
  returning id into v_id;
  foreach pid in array p_parcels loop
    perform private.parcel_event(pid, 'change_requested', p_reason, jsonb_build_object('change_id', v_id, 'kind', p_kind));
  end loop;
  return v_id;
end;
$$;

/** A new registered parcel cut from or combined out of existing ones (PUN, account, owners copied). */
create or replace function private.spawn_parcel(p_template uuid, p_geom extensions.geometry, p_source text)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  t public.parcels;
  v_ids record;
  v_id uuid;
begin
  select * into t from public.parcels where id = p_template;
  select * into v_ids from private.next_pun(t.district_id, t.neighbourhood_id);
  insert into public.parcels (pun, account_no, district_id, neighbourhood_id, street_id, ownership, land_use, developed, area_m2, perimeter_m, geom,
                              status, registered_at, registered_by, created_by)
  values (v_ids.pun, v_ids.account_no, t.district_id, t.neighbourhood_id, t.street_id, t.ownership, t.land_use, t.developed,
          round(st_area(p_geom::geography)::numeric, 2), round(st_perimeter(p_geom::geography)::numeric, 2), p_geom,
          'registered', now(), auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
  select v_id, party_id, role, share_pct from public.parcel_owners where parcel_id = p_template and valid_to is null;
  perform private.parcel_event(v_id, 'created_from', p_source, jsonb_build_object('source_parcel', p_template));
  return v_id;
end;
$$;

create or replace function public.parcel_change_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v public.parcel_changes;
  pid uuid;
  c jsonb;
  v_new uuid[] := '{}';
  v_geom geometry;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.parcel_changes where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'change');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.parcel_changes set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  foreach pid in array v.parcel_ids loop
    perform private.assert_no_blockers(pid, v.kind::text, p_id);
  end loop;

  if v.kind = 'subdivide' then
    perform private.validate_subdivision(v.parcel_ids[1], v.payload -> 'children');
    for c in select * from jsonb_array_elements(v.payload -> 'children') loop
      v_new := v_new || private.spawn_parcel(v.parcel_ids[1], st_setsrid(st_geomfromgeojson(c::text), 4326), v.number);
    end loop;
  elsif v.kind = 'merge' then
    select st_union(array(select st_snap(geom, (select st_collect(geom) from public.parcels where id = any (v.parcel_ids)), 0.000005)
                          from public.parcels where id = any (v.parcel_ids))) into v_geom;
    if geometrytype(v_geom) <> 'POLYGON' then
      perform private.raise_app_error('VALIDATION', 'merge_not_touching');
    end if;
    v_new := array[private.spawn_parcel(v.parcel_ids[1], v_geom, v.number)];
  else
    update public.parcels set land_use = (v.payload ->> 'land_use')::public.land_use where id = v.parcel_ids[1];
    perform private.parcel_event(v.parcel_ids[1], 'use_changed', v.reason, jsonb_build_object('change_id', p_id, 'land_use', v.payload ->> 'land_use'));
  end if;

  if v.kind in ('subdivide', 'merge') then
    foreach pid in array v.parcel_ids loop
      update public.parcels set status = 'archived' where id = pid;
      update public.parcel_owners set valid_to = current_date where parcel_id = pid and valid_to is null;
      perform private.cancel_parcel_documents(pid, v.kind::text || ' ' || v.number);
      perform private.parcel_event(pid, v.kind::text || 'd', v.reason, jsonb_build_object('change_id', p_id, 'new_parcels', to_jsonb(v_new)));
    end loop;
  end if;
  update public.parcel_changes set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), result_parcel_ids = v_new
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'new_parcels', to_jsonb(v_new));
end;
$$;

-- ---------------------------------------------------------------------------
-- Building permits
-- ---------------------------------------------------------------------------
create or replace function public.permit_apply(p_parcel uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
  v_inv uuid;
  v_fee numeric;
  v_number text := private.serial('PRM');
begin
  perform private.assert_permission('permits.create');
  v := private.scoped_parcel(p_parcel);
  perform private.assert_no_blockers(p_parcel, 'permit');
  if length(trim(coalesce(p ->> 'description', ''))) < 10 or length(trim(coalesce(p ->> 'applicant_name', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'permit');
  end if;
  select amount into v_fee from public.fee_types where code = 'building_permit' and active;
  v_inv := private.raise_fee_invoice(p_parcel, 'building_permit', v_fee, 'Building permit — ' || v_number);
  insert into public.permits (number, parcel_id, district_id, kind, description, floors, area_m2, applicant_name, applicant_phone, fee_invoice_id, requested_by)
  values (v_number, p_parcel, v.district_id, (p ->> 'kind')::public.permit_kind, trim(p ->> 'description'), nullif(p ->> 'floors', '')::int,
          nullif(p ->> 'area_m2', '')::numeric, trim(p ->> 'applicant_name'), nullif(trim(p ->> 'applicant_phone'), ''), v_inv, auth.uid())
  returning id into v_id;
  perform private.parcel_event(p_parcel, 'permit_applied', p ->> 'description', jsonb_build_object('permit_id', v_id));
  return jsonb_build_object('permit_id', v_id, 'number', v_number, 'fee_invoice_id', v_inv);
end;
$$;

create or replace function public.permit_decide(p_id uuid, p_approve boolean, p_conditions text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.permits;
begin
  perform private.assert_permission('permits.approve');
  select * into v from public.permits where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'permit');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.permits set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    update public.invoices set status = 'cancelled', cancel_reason = 'Permit rejected' where id = v.fee_invoice_id and paid = 0 and status <> 'cancelled';
  else
    if v.fee_invoice_id is not null and exists (select 1 from public.invoices where id = v.fee_invoice_id and status <> 'paid') then
      perform private.raise_app_error('CONFLICT', 'fee_unpaid');
    end if;
    perform private.assert_no_blockers(v.parcel_id, 'permit');
    update public.permits set status = 'approved', decided_by = auth.uid(), decided_at = now(), conditions = nullif(trim(p_conditions), ''),
           decision_note = nullif(trim(p_note), ''), valid_until = (current_date + make_interval(months => private.setting_int('permits.valid_months', 12)))::date
     where id = p_id;
  end if;
  perform private.parcel_event(v.parcel_id, case when p_approve then 'permit_approved' else 'permit_rejected' end, p_note, jsonb_build_object('permit_id', p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Leases of government land
-- ---------------------------------------------------------------------------
create or replace function public.lease_create(p_parcel uuid, p_lessee uuid, p_start date, p_end date, p_rent numeric, p_purpose text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('parcels.approve');
  v := private.scoped_parcel(p_parcel);
  if v.ownership <> 'public' then
    perform private.raise_app_error('VALIDATION', 'not_public_land');
  end if;
  perform private.assert_no_blockers(p_parcel, 'lease');
  if p_end <= p_start or p_rent is null or p_rent < 0 then
    perform private.raise_app_error('VALIDATION', 'lease_terms');
  end if;
  if not exists (select 1 from public.parties where id = p_lessee and deleted_at is null) then
    perform private.raise_app_error('VALIDATION', 'lessee');
  end if;
  insert into public.leases (number, parcel_id, district_id, lessee_party_id, start_date, end_date, annual_rent, purpose, created_by)
  values (private.serial('LSE'), p_parcel, v.district_id, p_lessee, p_start, p_end, round(p_rent, 2), nullif(trim(p_purpose), ''), auth.uid())
  returning id into v_id;
  perform private.parcel_event(p_parcel, 'lease_created', p_purpose, jsonb_build_object('lease_id', v_id));
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'lease_active');
end;
$$;

create or replace function public.lease_end(p_id uuid, p_terminate boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.leases;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.leases where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'lease');
  end if;
  if v.status <> 'active' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if length(trim(coalesce(p_note, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.leases set status = case when p_terminate then 'terminated'::public.lease_status else 'ended'::public.lease_status end,
         ended_by = auth.uid(), ended_at = now(), end_note = trim(p_note)
   where id = p_id;
  perform private.parcel_event(v.parcel_id, 'lease_ended', p_note, jsonb_build_object('lease_id', p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------
create or replace function public.parcel_legal_status(p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or not private.can_view_parcel(p_parcel) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return jsonb_build_object(
    'transfer', to_jsonb(private.parcel_blockers(p_parcel, 'transfer')),
    'subdivide', to_jsonb(private.parcel_blockers(p_parcel, 'subdivide')),
    'permit', to_jsonb(private.parcel_blockers(p_parcel, 'permit')));
end;
$$;

create or replace function public.legal_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'transfers_waiting', (select count(*) from public.transfers where status = 'submitted'),
    'transfers_draft', (select count(*) from public.transfers where status = 'draft'),
    'disputes_open', (select count(*) from public.disputes where status = 'open'),
    'liens_active', (select count(*) from public.liens where active),
    'orders_active', (select count(*) from public.court_orders where active),
    'changes_waiting', (select count(*) from public.parcel_changes where status = 'submitted'),
    'permits_waiting', (select count(*) from public.permits where status = 'submitted'),
    'leases_active', (select count(*) from public.leases where status = 'active'));
$$;

grant execute on function
  public.dispute_open(uuid, jsonb), public.dispute_close(uuid, public.dispute_status, text),
  public.court_order_add(uuid, jsonb), public.court_order_lift(uuid, text), public.lien_register(uuid, jsonb), public.lien_release(uuid, text),
  public.transfer_create(uuid, public.transfer_kind, numeric, uuid, text), public.transfer_set_recipients(uuid, jsonb), public.transfer_submit(uuid),
  public.transfer_decide(uuid, boolean, text), public.transfer_cancel(uuid, text),
  public.parcel_change_request(public.change_kind, uuid[], jsonb, text), public.parcel_change_decide(uuid, boolean, text),
  public.permit_apply(uuid, jsonb), public.permit_decide(uuid, boolean, text, text),
  public.lease_create(uuid, uuid, date, date, numeric, text), public.lease_end(uuid, boolean, text),
  public.parcel_legal_status(uuid), public.legal_counts()
to authenticated;
revoke execute on function
  public.dispute_open(uuid, jsonb), public.dispute_close(uuid, public.dispute_status, text),
  public.court_order_add(uuid, jsonb), public.court_order_lift(uuid, text), public.lien_register(uuid, jsonb), public.lien_release(uuid, text),
  public.transfer_create(uuid, public.transfer_kind, numeric, uuid, text), public.transfer_set_recipients(uuid, jsonb), public.transfer_submit(uuid),
  public.transfer_decide(uuid, boolean, text), public.transfer_cancel(uuid, text),
  public.parcel_change_request(public.change_kind, uuid[], jsonb, text), public.parcel_change_decide(uuid, boolean, text),
  public.permit_apply(uuid, jsonb), public.permit_decide(uuid, boolean, text, text),
  public.lease_create(uuid, uuid, date, date, numeric, text), public.lease_end(uuid, boolean, text),
  public.parcel_legal_status(uuid), public.legal_counts()
from public, anon;
revoke execute on function private.parcel_blockers(uuid, text, uuid), private.assert_no_blockers(uuid, text, uuid), private.scoped_parcel(uuid),
  private.cancel_parcel_documents(uuid, text), private.raise_fee_invoice(uuid, text, numeric, text), private.serial(text),
  private.refresh_parcel_status(uuid), private.validate_subdivision(uuid, jsonb), private.spawn_parcel(uuid, extensions.geometry, text)
from public, anon, authenticated;
