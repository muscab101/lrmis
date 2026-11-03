-- Owner types: a list staff manage on the Valuation page (individual, company, government...), chosen on the owner form.
create table public.owner_types (
  id          uuid primary key default gen_random_uuid(),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index owner_types_name_en_key on public.owner_types (lower(trim(name_en)));
create unique index owner_types_name_so_key on public.owner_types (lower(trim(name_so)));
create index owner_types_created_by_idx on public.owner_types (created_by);
create trigger set_updated_at before update on public.owner_types for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.owner_types for each row execute function private.audit_row();

alter table public.owner_types enable row level security;
revoke all on public.owner_types from public, anon;
revoke insert, update, delete on public.owner_types from authenticated;
grant select on public.owner_types to authenticated;
create policy owner_types_select on public.owner_types for select to authenticated using (true);

insert into public.owner_types (name_so, name_en, sort) values
  ('Shakhsi', 'Individual', 10),
  ('Qoys / Dhaxal', 'Family / Heirs', 20),
  ('Shirkad', 'Company', 30),
  ('Dawlad', 'Government', 40),
  ('Hay''ad', 'Organisation', 50),
  ('Masaajid / Diini', 'Mosque / Religious', 60);

alter table public.parties add column owner_type_id uuid references public.owner_types (id);
create index parties_owner_type_idx on public.parties (owner_type_id);

create function public.owner_type_save(p_id uuid, p jsonb)
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
    insert into public.owner_types (name_so, name_en, active, created_by)
    values (trim(p ->> 'name_so'), trim(p ->> 'name_en'), coalesce((p ->> 'active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.owner_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), active = coalesce((p ->> 'active')::boolean, active)
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'owner_type');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'owner_type_taken');
end;
$$;

/** Delete a type nobody has; one an owner has, deleted or not, is switched off. */
create function public.owner_type_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('valuation.update');
  perform 1 from public.owner_types where id = p_id for update;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'owner_type');
  end if;
  if exists (select 1 from public.parties where owner_type_id = p_id) then
    update public.owner_types set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.owner_types where id = p_id;
  return 'deleted';
end;
$$;

revoke all on function public.owner_type_save(uuid, jsonb), public.owner_type_delete(uuid) from public, anon;
grant execute on function public.owner_type_save(uuid, jsonb), public.owner_type_delete(uuid) to authenticated;

create or replace function public.save_party(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_type uuid := nullif(p ->> 'owner_type_id', '')::uuid;
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
  -- A type that was switched off can stay on the owner who has it, but isn't given to anyone new.
  if v_type is not null and v_type is distinct from v_existing.owner_type_id
     and not exists (select 1 from public.owner_types t where t.id = v_type and t.active) then
    perform private.raise_app_error('VALIDATION', 'owner_type');
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
                                phone, email, address, next_of_kin, org_registration_no, district_id, owner_type_id, created_by)
    values (coalesce(nullif(p ->> 'kind', ''), 'person')::public.party_kind, trim(p ->> 'full_name'),
            nullif(trim(p ->> 'mother_name'), ''), nullif(p ->> 'gender', ''), nullif(p ->> 'date_of_birth', '')::date,
            coalesce(nullif(p ->> 'nationality', ''), 'SO'), v_id_type, v_id_number,
            nullif(p ->> 'phone', ''), nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'address'), ''),
            coalesce(p -> 'next_of_kin', '{}'::jsonb), nullif(trim(p ->> 'org_registration_no'), ''), v_district, v_type, auth.uid())
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
           district_id = coalesce(v_district, district_id),
           owner_type_id = coalesce(v_type, owner_type_id)
     where id = p_id;
  end if;
  return v_id;
end;
$$;
