-- Building types: the list staff manage on Valuation → Building types. The land form's "Building type" choices come
-- from it. Each type says what kind of land it is (one house, a block of flats, or a compound of several houses) and
-- which Valuation price (property grade) bills it. Flats are still billed by floor (Apartment / Upper Floors) and the
-- empty land at the Empty Land price.

create table public.building_types (
  id          uuid primary key default gen_random_uuid(),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  layout      text not null check (layout in ('house', 'flats', 'compound')),
  grade_code  text not null references public.property_grades (code) on update cascade,
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index building_types_name_en_key on public.building_types (lower(trim(name_en)));
create unique index building_types_name_so_key on public.building_types (lower(trim(name_so)));
create index building_types_grade_idx on public.building_types (grade_code);
create index building_types_created_by_idx on public.building_types (created_by);
create trigger set_updated_at before update on public.building_types for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.building_types for each row execute function private.audit_row();

alter table public.building_types enable row level security;
revoke all on public.building_types from public, anon;
revoke insert, update, delete on public.building_types from authenticated;
grant select on public.building_types to authenticated;
create policy building_types_select on public.building_types for select to authenticated using (true);

-- Start with what the form offered until now: every house type as one house, the apartment types as flats, and a
-- compound of brick houses.
insert into public.building_types (name_so, name_en, layout, grade_code, sort)
select g.name_so, g.name_en,
       case when g.code ~* 'apartment|flat|storey|dabaq' or g.name_en ~* 'apartment|flat|storey|dabaq' then 'flats' else 'house' end,
       g.code,
       case when g.code ~* 'apartment|flat|storey|dabaq' or g.name_en ~* 'apartment|flat|storey|dabaq' then 50 else 10 end
from public.property_grades g
where g.active and g.code not in ('upper', 'open_ground')
on conflict do nothing;
insert into public.building_types (name_so, name_en, layout, grade_code, sort)
select 'Xero guryo ah', 'Compound of houses', 'compound', 'brick_house', 80
where exists (select 1 from public.property_grades where code = 'brick_house')
on conflict do nothing;

create function public.building_type_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform private.assert_permission('valuation.update');
  if coalesce(p ->> 'layout', '') not in ('house', 'flats', 'compound') then
    perform private.raise_app_error('VALIDATION', 'building_layout');
  end if;
  if not exists (select 1 from public.property_grades where code = p ->> 'grade_code') then
    perform private.raise_app_error('VALIDATION', 'building_grade');
  end if;
  if v_id is null then
    insert into public.building_types (name_so, name_en, layout, grade_code, active, created_by)
    values (trim(p ->> 'name_so'), trim(p ->> 'name_en'), p ->> 'layout', p ->> 'grade_code', coalesce((p ->> 'active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.building_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), layout = p ->> 'layout', grade_code = p ->> 'grade_code',
           active = coalesce((p ->> 'active')::boolean, active)
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'building_type');
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    perform private.raise_app_error('CONFLICT', 'building_type_taken');
  when check_violation then
    perform private.raise_app_error('VALIDATION', 'name');
end;
$$;

/** Delete a building type. Land already saved keeps its kind and price type, so nothing else changes. */
create function public.building_type_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('valuation.update');
  delete from public.building_types where id = p_id;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'building_type');
  end if;
end;
$$;

revoke all on function public.building_type_save(uuid, jsonb), public.building_type_delete(uuid) from public, anon;
grant execute on function public.building_type_save(uuid, jsonb), public.building_type_delete(uuid) to authenticated;
