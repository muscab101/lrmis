-- ============================================================================
-- 0046 Property types managed by admins (instead of a fixed list).
--
-- Admins (settings.update) add, rename, price and hide the types of house /
-- land on their own page; staff pick from the active ones when adding land.
-- The ten types from 0045 are the starting list (price 0) so existing records
-- keep their type. A type in use can be hidden but not deleted.
-- ============================================================================

create table public.property_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  price       numeric(14, 2) not null default 0 check (price >= 0),
  currency    text not null default 'USD' check (currency in ('USD', 'SOS')),
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index property_types_created_by_idx on public.property_types (created_by);
create trigger set_updated_at before update on public.property_types for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.property_types for each row execute function private.audit_row();

insert into public.property_types (code, name_so, name_en, sort) values
  ('empty_land',  'Dhul bannaan',        'Empty land',                       10),
  ('stone_house', 'Guri dhagax / bloog', 'Stone / block house',              20),
  ('tin_house',   'Guri jiingad',        'Tin house (jiingad)',              30),
  ('hut',         'Aqal / cariish',      'Traditional hut (aqal / cariish)', 40),
  ('villa',       'Fiilo',               'Villa',                            50),
  ('apartment',   'Dabaq guryo',         'Apartment block',                  60),
  ('shop',        'Dukaan',              'Shop',                             70),
  ('warehouse',   'Bakhaar',             'Warehouse',                        80),
  ('farm',        'Beer',                'Farm',                             90),
  ('other',       'Kale',                'Other',                           999);

alter table public.property_types enable row level security;
create policy property_types_select on public.property_types for select to authenticated using (true);

-- Applications and parcels point at the list instead of a fixed check.
alter table public.applications drop constraint applications_property_type_check;
alter table public.parcels drop constraint parcels_property_type_check;
alter table public.applications add constraint applications_property_type_fkey
  foreign key (property_type) references public.property_types (code) on update cascade;
alter table public.parcels add constraint parcels_property_type_fkey
  foreign key (property_type) references public.property_types (code) on update cascade;
create index applications_property_type_idx on public.applications (property_type);
create index parcels_property_type_idx on public.parcels (property_type);

/**
 * Create (p_id null) or update a property type. p: {name_so, name_en, price, currency, active, sort}.
 * The code is made from the English name on create and never changes.
 */
create function public.property_type_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_code text;
  v_price numeric := coalesce(nullif(p ->> 'price', '')::numeric, 0);
begin
  perform private.assert_permission('settings.update');
  if length(coalesce(trim(p ->> 'name_so'), '')) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_so');
  end if;
  if length(coalesce(trim(p ->> 'name_en'), '')) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_en');
  end if;
  if v_price < 0 then
    perform private.raise_app_error('VALIDATION', 'price');
  end if;
  if p_id is null then
    v_code := left(trim(both '_' from regexp_replace(lower(trim(p ->> 'name_en')), '[^a-z0-9]+', '_', 'g')), 34);
    if length(v_code) < 2 then
      v_code := 'type';
    end if;
    -- Keep codes unique: add a number when the name was used before.
    if exists (select 1 from public.property_types where code = v_code) then
      v_code := v_code || '_' || (select count(*) + 1 from public.property_types where code like v_code || '%');
    end if;
    insert into public.property_types (code, name_so, name_en, price, currency, active, sort, created_by)
    values (v_code, trim(p ->> 'name_so'), trim(p ->> 'name_en'), round(v_price, 2),
            coalesce(nullif(p ->> 'currency', ''), 'USD'), coalesce((p ->> 'active')::boolean, true),
            coalesce(nullif(p ->> 'sort', '')::int, 100), auth.uid())
    returning id into v_id;
  else
    update public.property_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), price = round(v_price, 2),
           currency = coalesce(nullif(p ->> 'currency', ''), currency),
           active = coalesce((p ->> 'active')::boolean, active),
           sort = coalesce(nullif(p ->> 'sort', '')::int, sort)
     where id = p_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'property_type');
    end if;
  end if;
  return v_id;
end;
$$;

/** Delete a type nobody uses yet; a type in use is hidden (active = false) instead. Returns 'deleted' or 'hidden'. */
create function public.property_type_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.property_types;
begin
  perform private.assert_permission('settings.update');
  select * into v from public.property_types where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'property_type');
  end if;
  if exists (select 1 from public.applications where property_type = v.code)
     or exists (select 1 from public.parcels where property_type = v.code) then
    update public.property_types set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.property_types where id = p_id;
  return 'deleted';
end;
$$;

revoke all on function public.property_type_save(uuid, jsonb), public.property_type_delete(uuid) from public, anon;
grant execute on function public.property_type_save(uuid, jsonb), public.property_type_delete(uuid) to authenticated;

/** A hidden type can't be chosen for new or changed land (existing records keep it). */
create function private.assert_property_type_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.property_type is not null
     and new.property_type is distinct from (case when tg_op = 'UPDATE' then old.property_type end)
     and not exists (select 1 from public.property_types where code = new.property_type and active) then
    perform private.raise_app_error('VALIDATION', 'property_type_inactive');
  end if;
  return new;
end;
$$;
create trigger property_type_active before insert or update of property_type on public.applications
  for each row execute function private.assert_property_type_active();
revoke all on function private.assert_property_type_active() from public, anon, authenticated;
