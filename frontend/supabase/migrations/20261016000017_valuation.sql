-- ============================================================================
-- 0017 Phase 5 — Valuation, rates, assessments, exemptions, appeals (§4.6).
--   annual_tax = rate[land_use][developed] × area_m² + Σ(building grade amount × units)
--                − exemption + service charge
-- Rates are kept per neighbourhood with valid_from dates (history is never overwritten).
-- All amounts are in the base currency (USD) until multi-currency arrives in Phase 7.
-- ============================================================================

create type public.fee_interval as enum ('monthly', 'quarterly', 'biannual', 'annual', 'one_off');
create type public.exemption_kind as enum ('mosque', 'school', 'hospital', 'government', 'hardship', 'other');
create type public.decision_status as enum ('pending', 'approved', 'rejected');
create type public.assessment_status as enum ('issued', 'superseded');
create type public.appeal_status as enum ('open', 'upheld', 'rejected', 'withdrawn');

insert into public.settings (key, value, description) values
  ('valuation.default_rate_m2', '0.25', 'Land rate per m² when a neighbourhood has no rate yet (USD)'),
  ('valuation.currency', '"USD"', 'Currency of rates and assessments')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Configuration: property grades and fee types
-- ---------------------------------------------------------------------------
create table public.property_grades (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  amount      numeric(12, 2) not null check (amount >= 0),
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);
comment on column public.property_grades.amount is 'Yearly amount per building unit of this grade';

create table public.fee_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  interval    public.fee_interval not null default 'annual',
  amount      numeric(12, 2) not null default 0 check (amount >= 0),
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);
comment on column public.fee_types.amount is 'Default amount for fixed fees; property tax is computed by assessment';

insert into public.property_grades (code, name_so, name_en, amount, sort) values
  ('villa', 'Fiilo', 'Villa', 150, 10),
  ('storey', 'Dabaq', 'Storey building', 110, 20),
  ('brick_house', 'Guri dhagax', 'Brick house', 45, 30),
  ('cariish', 'Cariish', 'Cariish (iron-roofed)', 15, 40),
  ('baraako', 'Baraako', 'Baraako', 10, 50),
  ('jiingad', 'Jiingad', 'Jiingad (tin shack)', 6, 60),
  ('shop', 'Dukaan', 'Shop unit', 60, 70),
  ('warehouse', 'Bakhaar', 'Warehouse', 80, 80);

insert into public.fee_types (code, name_so, name_en, interval, amount, sort) values
  ('property_tax', 'Canshuurta hantida', 'Property tax', 'annual', 0, 10),
  ('service_charge', 'Khidmadda adeegga', 'Service charge', 'annual', 0, 20),
  ('application_fee', 'Khidmadda codsiga', 'Application fee', 'one_off', 25, 30),
  ('certificate_fee', 'Khidmadda shahaadada', 'Certificate fee', 'one_off', 20, 40),
  ('transfer_stamp_duty', 'Canshuurta wareejinta', 'Transfer stamp duty', 'one_off', 0, 50);

-- ---------------------------------------------------------------------------
-- Neighbourhood rates with history
-- ---------------------------------------------------------------------------
create table public.neighbourhood_rates (
  id                uuid primary key default gen_random_uuid(),
  neighbourhood_id  uuid not null references public.neighbourhoods (id),
  district_id       uuid not null references public.districts (id),
  land_use          public.land_use not null,
  developed         boolean not null,
  rate_m2           numeric(10, 4) not null check (rate_m2 >= 0),
  service_charge    numeric(12, 2) not null default 0 check (service_charge >= 0),
  valid_from        date not null,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  unique (neighbourhood_id, land_use, developed, valid_from)
);
create index neighbourhood_rates_lookup_idx on public.neighbourhood_rates (neighbourhood_id, land_use, developed, valid_from desc);

-- ---------------------------------------------------------------------------
-- Buildings on a parcel
-- ---------------------------------------------------------------------------
create table public.buildings (
  id          uuid primary key default gen_random_uuid(),
  parcel_id   uuid not null references public.parcels (id),
  grade_id    uuid not null references public.property_grades (id),
  units       int not null default 1 check (units between 1 and 500),
  floors      int not null default 1 check (floors between 0 and 60),
  area_m2     numeric(10, 2) check (area_m2 is null or area_m2 > 0),
  use         text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  deleted_at  timestamptz
);
create index buildings_parcel_idx on public.buildings (parcel_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Exemptions (maker-checker)
-- ---------------------------------------------------------------------------
create table public.exemptions (
  id             uuid primary key default gen_random_uuid(),
  parcel_id      uuid not null references public.parcels (id),
  kind           public.exemption_kind not null,
  pct            numeric(5, 2) not null check (pct > 0 and pct <= 100),
  reason         text not null check (length(trim(reason)) >= 3),
  valid_from     date not null,
  valid_to       date,
  status         public.decision_status not null default 'pending',
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  check (valid_to is null or valid_to >= valid_from)
);
create index exemptions_parcel_idx on public.exemptions (parcel_id, status);

-- ---------------------------------------------------------------------------
-- Assessments and appeals
-- ---------------------------------------------------------------------------
create table public.assessments (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  parcel_id         uuid not null references public.parcels (id),
  district_id       uuid not null references public.districts (id),
  year              int not null check (year between 2000 and 2100),
  land_use          public.land_use not null,
  developed         boolean not null,
  area_m2           numeric(12, 2) not null,
  rate_m2           numeric(10, 4) not null,
  rate_id           uuid references public.neighbourhood_rates (id),
  land_amount       numeric(14, 2) not null,
  buildings_amount  numeric(14, 2) not null,
  exemption_pct     numeric(5, 2) not null default 0,
  exemption_amount  numeric(14, 2) not null default 0,
  service_charge    numeric(14, 2) not null default 0,
  total             numeric(14, 2) not null check (total >= 0),
  breakdown         jsonb not null default '{}'::jsonb,
  override_note     text,
  status            public.assessment_status not null default 'issued',
  supersedes_id     uuid references public.assessments (id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);
-- One live assessment per parcel and year.
create unique index assessments_live_uidx on public.assessments (parcel_id, year) where status = 'issued';
create index assessments_district_idx on public.assessments (district_id, year);

create table public.assessment_counters (
  year         int primary key,
  last_serial  int not null default 0
);

create table public.appeals (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public.assessments (id),
  parcel_id         uuid not null references public.parcels (id),
  reason            text not null check (length(trim(reason)) >= 10),
  requested_total   numeric(14, 2) check (requested_total is null or requested_total >= 0),
  status            public.appeal_status not null default 'open',
  filed_by          uuid references auth.users (id) on delete set null,
  filed_at          timestamptz not null default now(),
  decided_by        uuid references auth.users (id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,
  new_assessment_id uuid references public.assessments (id)
);
create unique index appeals_one_open_uidx on public.appeals (assessment_id) where status = 'open';

create trigger set_updated_at before update on public.property_grades for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fee_types for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.buildings for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.property_grades for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.fee_types for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.neighbourhood_rates for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.buildings for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.exemptions for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.assessments for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.appeals for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: configuration is readable by signed-in users; parcel data follows the parcel.
-- Every write goes through the RPCs below.
-- ---------------------------------------------------------------------------
alter table public.property_grades enable row level security;
alter table public.fee_types enable row level security;
alter table public.neighbourhood_rates enable row level security;
alter table public.buildings enable row level security;
alter table public.exemptions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_counters enable row level security;
alter table public.appeals enable row level security;

revoke all on public.property_grades, public.fee_types, public.neighbourhood_rates, public.buildings, public.exemptions,
  public.assessments, public.assessment_counters, public.appeals from anon;
revoke insert, update, delete on public.property_grades, public.fee_types, public.neighbourhood_rates, public.buildings,
  public.exemptions, public.assessments, public.assessment_counters, public.appeals from authenticated;
revoke select on public.assessment_counters from authenticated;

create policy property_grades_select on public.property_grades for select to authenticated using (true);
create policy fee_types_select on public.fee_types for select to authenticated using (true);
create policy neighbourhood_rates_select on public.neighbourhood_rates for select to authenticated
  using (public.has_permission('valuation.view') and public.can_access_district(district_id));
create policy buildings_select on public.buildings for select to authenticated
  using (deleted_at is null and private.can_view_parcel(parcel_id));
create policy exemptions_select on public.exemptions for select to authenticated using (private.can_view_parcel(parcel_id));
create policy assessments_select on public.assessments for select to authenticated using (private.can_view_parcel(parcel_id));
create policy appeals_select on public.appeals for select to authenticated using (private.can_view_parcel(parcel_id));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default);
$$;

/** The parcel's registered owners can file appeals on its assessments. */
create or replace function private.is_parcel_owner(p_parcel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                 where po.parcel_id = p_parcel and po.valid_to is null and pa.citizen_user_id = auth.uid());
$$;

/** Staff with valuation rights over the parcel's district. */
create or replace function private.assert_parcel_scope(p_parcel uuid)
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

/** The rate in force on a date: newest valid_from on or before it. */
create or replace function private.rate_for(p_neighbourhood uuid, p_use public.land_use, p_developed boolean, p_on date)
returns public.neighbourhood_rates
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.neighbourhood_rates r
  where r.neighbourhood_id = p_neighbourhood and r.land_use = p_use and r.developed = p_developed and r.valid_from <= p_on
  order by r.valid_from desc
  limit 1;
$$;

/**
 * Compute (not store) the assessment for a parcel and year, with every input in the breakdown.
 * The rate in force on 1 January of the year applies; exemptions overlapping the year apply (highest %).
 */
create or replace function private.compute_assessment(p_parcel uuid, p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_on date := make_date(p_year, 1, 1);
  v_rate public.neighbourhood_rates;
  v_rate_m2 numeric;
  v_land numeric;
  v_buildings numeric;
  v_lines jsonb;
  v_ex record;
  v_ex_pct numeric := 0;
  v_service numeric;
  v_subtotal numeric;
  v_ex_amount numeric;
begin
  select * into v_p from public.parcels where id = p_parcel;
  v_rate := private.rate_for(v_p.neighbourhood_id, v_p.land_use, v_p.developed, v_on);
  v_rate_m2 := coalesce(v_rate.rate_m2, private.setting_numeric('valuation.default_rate_m2', 0.25));
  v_land := round(v_rate_m2 * coalesce(v_p.area_m2, 0), 2);

  select coalesce(sum(round(g.amount * b.units, 2)), 0),
         coalesce(jsonb_agg(jsonb_build_object('building_id', b.id, 'grade', g.code, 'grade_so', g.name_so, 'grade_en', g.name_en,
                                               'units', b.units, 'amount', g.amount, 'line', round(g.amount * b.units, 2))
                            order by g.sort), '[]'::jsonb)
    into v_buildings, v_lines
  from public.buildings b join public.property_grades g on g.id = b.grade_id
  where b.parcel_id = p_parcel and b.deleted_at is null;

  select e.id, e.kind, e.pct into v_ex from public.exemptions e
  where e.parcel_id = p_parcel and e.status = 'approved'
    and e.valid_from <= make_date(p_year, 12, 31) and (e.valid_to is null or e.valid_to >= v_on)
  order by e.pct desc limit 1;
  v_ex_pct := coalesce(v_ex.pct, 0);

  v_service := coalesce(v_rate.service_charge, 0);
  v_subtotal := v_land + v_buildings;
  v_ex_amount := round(v_subtotal * v_ex_pct / 100, 2);

  return jsonb_build_object(
    'parcel_id', p_parcel, 'year', p_year, 'land_use', v_p.land_use, 'developed', v_p.developed,
    'area_m2', coalesce(v_p.area_m2, 0), 'rate_m2', v_rate_m2, 'rate_id', v_rate.id,
    'rate_source', case when v_rate.id is null then 'default' else 'neighbourhood' end,
    'rate_valid_from', v_rate.valid_from,
    'land_amount', v_land, 'buildings', v_lines, 'buildings_amount', v_buildings,
    'exemption_id', v_ex.id, 'exemption_kind', v_ex.kind, 'exemption_pct', v_ex_pct, 'exemption_amount', v_ex_amount,
    'service_charge', v_service,
    'total', greatest(v_subtotal - v_ex_amount + v_service, 0));
end;
$$;

create or replace function private.next_assessment_number(p_year int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  insert into public.assessment_counters (year) values (p_year) on conflict do nothing;
  update public.assessment_counters set last_serial = last_serial + 1 where year = p_year returning last_serial into v;
  return 'ASM-' || p_year || '-' || lpad(v::text, 6, '0');
end;
$$;

/** Store a computed (or overridden) assessment, superseding the live one for that year. */
create or replace function private.store_assessment(p_parcel uuid, p_year int, p_calc jsonb, p_override numeric, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_id uuid;
  v_district uuid;
begin
  select district_id into v_district from public.parcels where id = p_parcel;
  update public.assessments set status = 'superseded' where parcel_id = p_parcel and year = p_year and status = 'issued'
  returning id into v_old;
  insert into public.assessments (number, parcel_id, district_id, year, land_use, developed, area_m2, rate_m2, rate_id,
                                  land_amount, buildings_amount, exemption_pct, exemption_amount, service_charge, total,
                                  breakdown, override_note, supersedes_id, created_by)
  values (private.next_assessment_number(p_year), p_parcel, v_district, p_year, (p_calc ->> 'land_use')::public.land_use,
          (p_calc ->> 'developed')::boolean, (p_calc ->> 'area_m2')::numeric, (p_calc ->> 'rate_m2')::numeric,
          nullif(p_calc ->> 'rate_id', '')::uuid, (p_calc ->> 'land_amount')::numeric, (p_calc ->> 'buildings_amount')::numeric,
          (p_calc ->> 'exemption_pct')::numeric, (p_calc ->> 'exemption_amount')::numeric, (p_calc ->> 'service_charge')::numeric,
          coalesce(p_override, (p_calc ->> 'total')::numeric), p_calc, nullif(trim(p_note), ''), v_old, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuration RPCs (valuation.update)
-- ---------------------------------------------------------------------------
create or replace function public.valuation_save_grade(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform private.assert_permission('valuation.update');
  if v_id is null then
    insert into public.property_grades (code, name_so, name_en, amount, active, sort, created_by)
    values (lower(trim(p ->> 'code')), trim(p ->> 'name_so'), trim(p ->> 'name_en'), (p ->> 'amount')::numeric,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 100), auth.uid())
    returning id into v_id;
  else
    update public.property_grades
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), amount = (p ->> 'amount')::numeric,
           active = coalesce((p ->> 'active')::boolean, active), sort = coalesce((p ->> 'sort')::int, sort)
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'grade');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'code_taken');
end;
$$;

create or replace function public.valuation_save_fee_type(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform private.assert_permission('valuation.update');
  if v_id is null then
    insert into public.fee_types (code, name_so, name_en, interval, amount, active, sort, created_by)
    values (lower(trim(p ->> 'code')), trim(p ->> 'name_so'), trim(p ->> 'name_en'), (p ->> 'interval')::public.fee_interval,
            coalesce((p ->> 'amount')::numeric, 0), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 100), auth.uid())
    returning id into v_id;
  else
    update public.fee_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), interval = (p ->> 'interval')::public.fee_interval,
           amount = coalesce((p ->> 'amount')::numeric, amount), active = coalesce((p ->> 'active')::boolean, active),
           sort = coalesce((p ->> 'sort')::int, sort)
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'fee_type');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'code_taken');
end;
$$;

/** Add a rate from a date. Past rates are never edited: a correction is a new row. */
create or replace function public.valuation_set_rate(p_neighbourhood uuid, p_use public.land_use, p_developed boolean,
                                                     p_rate numeric, p_service numeric, p_valid_from date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid;
  v_id uuid;
begin
  perform private.assert_permission('valuation.update');
  select district_id into v_district from public.neighbourhoods where id = p_neighbourhood and deleted_at is null;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  if p_rate is null or p_rate < 0 or coalesce(p_service, 0) < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  insert into public.neighbourhood_rates (neighbourhood_id, district_id, land_use, developed, rate_m2, service_charge, valid_from, note, created_by)
  values (p_neighbourhood, v_district, p_use, p_developed, p_rate, coalesce(p_service, 0), p_valid_from, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'rate_exists');
end;
$$;

-- ---------------------------------------------------------------------------
-- Buildings (valuation.update in the parcel's district)
-- ---------------------------------------------------------------------------
create or replace function public.building_save(p_id uuid, p_parcel uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_grade uuid := (p ->> 'grade_id')::uuid;
begin
  perform private.assert_permission('valuation.update');
  perform private.assert_parcel_scope(p_parcel);
  if not exists (select 1 from public.property_grades where id = v_grade and active) then
    perform private.raise_app_error('VALIDATION', 'grade');
  end if;
  if v_id is null then
    insert into public.buildings (parcel_id, grade_id, units, floors, area_m2, use, note, created_by)
    values (p_parcel, v_grade, coalesce((p ->> 'units')::int, 1), coalesce((p ->> 'floors')::int, 1),
            nullif(p ->> 'area_m2', '')::numeric, nullif(trim(p ->> 'use'), ''), nullif(trim(p ->> 'note'), ''), auth.uid())
    returning id into v_id;
  else
    update public.buildings
       set grade_id = v_grade, units = coalesce((p ->> 'units')::int, units), floors = coalesce((p ->> 'floors')::int, floors),
           area_m2 = nullif(p ->> 'area_m2', '')::numeric, use = nullif(trim(p ->> 'use'), ''), note = nullif(trim(p ->> 'note'), '')
     where id = v_id and parcel_id = p_parcel and deleted_at is null;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'building');
    end if;
  end if;
  perform private.parcel_event(p_parcel, 'building_saved', null, jsonb_build_object('building_id', v_id));
  return v_id;
end;
$$;

create or replace function public.building_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcel uuid;
begin
  perform private.assert_permission('valuation.update');
  select parcel_id into v_parcel from public.buildings where id = p_id and deleted_at is null;
  if v_parcel is null then
    perform private.raise_app_error('NOT_FOUND', 'building');
  end if;
  perform private.assert_parcel_scope(v_parcel);
  update public.buildings set deleted_at = now() where id = p_id;
  perform private.parcel_event(v_parcel, 'building_removed', null, jsonb_build_object('building_id', p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Exemptions: requested by valuation staff, decided by someone else with valuation.approve
-- ---------------------------------------------------------------------------
create or replace function public.exemption_request(p_parcel uuid, p_kind public.exemption_kind, p_pct numeric, p_reason text,
                                                    p_valid_from date, p_valid_to date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_permission('valuation.create');
  perform private.assert_parcel_scope(p_parcel);
  if coalesce(trim(p_reason), '') = '' then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  insert into public.exemptions (parcel_id, kind, pct, reason, valid_from, valid_to, requested_by)
  values (p_parcel, p_kind, p_pct, trim(p_reason), p_valid_from, p_valid_to, auth.uid())
  returning id into v_id;
  perform private.parcel_event(p_parcel, 'exemption_requested', p_reason, jsonb_build_object('kind', p_kind, 'pct', p_pct));
  return v_id;
end;
$$;

create or replace function public.exemption_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.exemptions;
begin
  perform private.assert_permission('valuation.approve');
  select * into v from public.exemptions where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'exemption');
  end if;
  perform private.assert_parcel_scope(v.parcel_id);
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve and coalesce(trim(p_note), '') = '' then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.exemptions
     set status = case when p_approve then 'approved'::public.decision_status else 'rejected'::public.decision_status end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  perform private.parcel_event(v.parcel_id, case when p_approve then 'exemption_approved' else 'exemption_rejected' end, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------
/** What the assessment would be, without storing anything. */
create or replace function public.assessment_preview(p_parcel uuid, p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('valuation.view');
  perform private.assert_parcel_scope(p_parcel);
  return private.compute_assessment(p_parcel, p_year);
end;
$$;

/** Assess one registered parcel for a year (replaces that year's live assessment). */
create or replace function public.assess_parcel(p_parcel uuid, p_year int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_calc jsonb;
  v_id uuid;
  v_owner record;
begin
  perform private.assert_permission('valuation.create');
  v_p := private.assert_parcel_scope(p_parcel);
  if v_p.status not in ('registered', 'disputed') then
    perform private.raise_app_error('CONFLICT', 'parcel_not_registered');
  end if;
  if p_year < extract(year from now())::int - 5 or p_year > extract(year from now())::int + 1 then
    perform private.raise_app_error('VALIDATION', 'year');
  end if;
  if exists (select 1 from public.appeals a join public.assessments s on s.id = a.assessment_id
             where s.parcel_id = p_parcel and s.year = p_year and a.status = 'open') then
    perform private.raise_app_error('CONFLICT', 'appeal_open');
  end if;
  v_calc := private.compute_assessment(p_parcel, p_year);
  v_id := private.store_assessment(p_parcel, p_year, v_calc, null, null);
  perform private.parcel_event(p_parcel, 'assessed', null, jsonb_build_object('assessment_id', v_id, 'year', p_year, 'total', v_calc -> 'total'));
  for v_owner in select distinct pa.citizen_user_id from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                 where po.parcel_id = p_parcel and po.valid_to is null and pa.citizen_user_id is not null loop
    perform private.notify(v_owner.citizen_user_id, 'assessment.issued',
      'Qiimeynta ' || p_year || ': ' || coalesce(v_p.pun, ''), 'Assessment ' || p_year || ': ' || coalesce(v_p.pun, ''),
      '/portal');
  end loop;
  return jsonb_build_object('assessment_id', v_id, 'total', v_calc -> 'total');
end;
$$;

/** Assess every registered parcel of a neighbourhood for a year. Returns how many were assessed / skipped. */
create or replace function public.assess_neighbourhood(p_neighbourhood uuid, p_year int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_district uuid;
  v_parcel uuid;
  v_done int := 0;
  v_skipped int := 0;
begin
  perform private.assert_permission('valuation.create');
  select district_id into v_district from public.neighbourhoods where id = p_neighbourhood;
  if v_district is null or not public.can_access_district(v_district) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  for v_parcel in select id from public.parcels where neighbourhood_id = p_neighbourhood and status = 'registered' and deleted_at is null loop
    if exists (select 1 from public.appeals a join public.assessments s on s.id = a.assessment_id
               where s.parcel_id = v_parcel and s.year = p_year and a.status = 'open') then
      v_skipped := v_skipped + 1;
    else
      perform public.assess_parcel(v_parcel, p_year);
      v_done := v_done + 1;
    end if;
  end loop;
  return jsonb_build_object('assessed', v_done, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Appeals: an owner (citizen) or staff on their behalf files; valuation.approve decides.
-- Upheld with a new total → a corrected assessment supersedes the appealed one.
-- ---------------------------------------------------------------------------
create or replace function public.appeal_file(p_assessment uuid, p_reason text, p_requested numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
  v_id uuid;
begin
  if not private.caller_is_active() then
    perform private.raise_app_error('UNAUTHENTICATED');
  end if;
  select * into v from public.assessments where id = p_assessment;
  if v.id is null or not (private.is_parcel_owner(v.parcel_id)
                          or (public.has_permission('valuation.create') and public.can_access_district(v.district_id))) then
    perform private.raise_app_error('NOT_FOUND', 'assessment');
  end if;
  if v.status <> 'issued' then
    perform private.raise_app_error('CONFLICT', 'superseded');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  insert into public.appeals (assessment_id, parcel_id, reason, requested_total, filed_by)
  values (p_assessment, v.parcel_id, trim(p_reason), p_requested, auth.uid())
  returning id into v_id;
  perform private.parcel_event(v.parcel_id, 'appeal_filed', p_reason, jsonb_build_object('assessment_id', p_assessment));
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'appeal_open');
end;
$$;

create or replace function public.appeal_decide(p_id uuid, p_status public.appeal_status, p_new_total numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appeals;
  v_a public.assessments;
  v_new uuid;
begin
  select * into v from public.appeals where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'appeal');
  end if;
  if v.status <> 'open' or p_status = 'open' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if p_status = 'withdrawn' then
    if v.filed_by is distinct from auth.uid() then
      perform private.assert_permission('valuation.approve');
    end if;
  else
    perform private.assert_permission('valuation.approve');
    perform private.assert_parcel_scope(v.parcel_id);
    perform private.assert_maker_checker(v.filed_by);
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
  end if;
  select * into v_a from public.assessments where id = v.assessment_id;
  if p_status = 'upheld' then
    if p_new_total is null or p_new_total < 0 or p_new_total >= v_a.total then
      perform private.raise_app_error('VALIDATION', 'new_total');
    end if;
    v_new := private.store_assessment(v.parcel_id, v_a.year, v_a.breakdown || jsonb_build_object('appeal_id', p_id),
                                      round(p_new_total, 2), 'Appeal: ' || trim(p_note));
  end if;
  update public.appeals set status = p_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(p_note), ''), new_assessment_id = v_new
   where id = p_id;
  perform private.parcel_event(v.parcel_id, 'appeal_' || p_status::text, p_note, jsonb_build_object('new_assessment_id', v_new));
  return jsonb_build_object('status', p_status, 'new_assessment_id', v_new);
end;
$$;

/** Counts for the valuation tabs. */
create or replace function public.valuation_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'assessments', (select count(*) from public.assessments where status = 'issued'),
    'exemptions_pending', (select count(*) from public.exemptions where status = 'pending'),
    'appeals_open', (select count(*) from public.appeals where status = 'open'));
$$;

grant execute on function private.setting_numeric(text, numeric), private.is_parcel_owner(uuid) to authenticated;
grant execute on function
  public.valuation_save_grade(uuid, jsonb), public.valuation_save_fee_type(uuid, jsonb),
  public.valuation_set_rate(uuid, public.land_use, boolean, numeric, numeric, date, text),
  public.building_save(uuid, uuid, jsonb), public.building_remove(uuid),
  public.exemption_request(uuid, public.exemption_kind, numeric, text, date, date), public.exemption_decide(uuid, boolean, text),
  public.assessment_preview(uuid, int), public.assess_parcel(uuid, int), public.assess_neighbourhood(uuid, int),
  public.appeal_file(uuid, text, numeric), public.appeal_decide(uuid, public.appeal_status, numeric, text),
  public.valuation_counts()
to authenticated;
revoke execute on function private.compute_assessment(uuid, int), private.store_assessment(uuid, int, jsonb, numeric, text),
  private.next_assessment_number(int), private.rate_for(uuid, public.land_use, boolean, date), private.assert_parcel_scope(uuid)
from public, anon, authenticated;

-- Functions are executable by PUBLIC by default; only signed-in users may call these.
revoke execute on function
  public.valuation_save_grade(uuid, jsonb), public.valuation_save_fee_type(uuid, jsonb),
  public.valuation_set_rate(uuid, public.land_use, boolean, numeric, numeric, date, text),
  public.building_save(uuid, uuid, jsonb), public.building_remove(uuid),
  public.exemption_request(uuid, public.exemption_kind, numeric, text, date, date), public.exemption_decide(uuid, boolean, text),
  public.assessment_preview(uuid, int), public.assess_parcel(uuid, int), public.assess_neighbourhood(uuid, int),
  public.appeal_file(uuid, text, numeric), public.appeal_decide(uuid, public.appeal_status, numeric, text),
  public.valuation_counts(), private.setting_numeric(text, numeric), private.is_parcel_owner(uuid)
from public, anon;
