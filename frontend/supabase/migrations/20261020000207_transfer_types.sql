-- Transfer types: a list staff manage on Valuation → Transfer types (sale, gift, inheritance, court order, and any
-- the office adds, like "Exchange" or "Company to owner"). The transfer form's choices come from it. Each type says
-- which rules it follows (a court-order type needs the court's order; the others don't) and its stamp duty in USD.

create table public.transfer_types (
  id          uuid primary key default gen_random_uuid(),
  name_so     text not null check (length(trim(name_so)) >= 2),
  name_en     text not null check (length(trim(name_en)) >= 2),
  works_as    public.transfer_kind not null,
  duty        numeric(14, 2) not null default 0 check (duty >= 0 and duty <= 1000000),
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index transfer_types_name_en_key on public.transfer_types (lower(trim(name_en)));
create unique index transfer_types_name_so_key on public.transfer_types (lower(trim(name_so)));
create index transfer_types_created_by_idx on public.transfer_types (created_by);
create trigger set_updated_at before update on public.transfer_types for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.transfer_types for each row execute function private.audit_row();

alter table public.transfer_types enable row level security;
revoke all on public.transfer_types from public, anon;
revoke insert, update, delete on public.transfer_types from authenticated;
grant select on public.transfer_types to authenticated;
create policy transfer_types_select on public.transfer_types for select to authenticated using (true);

-- The four there were, with the stamp duty they charged until now.
insert into public.transfer_types (name_so, name_en, works_as, duty, sort) values
  ('Iib', 'Sale', 'sale', private.setting_numeric('transfers.stamp_duty_min', 10), 10),
  ('Hadiyad', 'Gift', 'gift', private.setting_numeric('transfers.stamp_duty_min', 10), 20),
  ('Dhaxal', 'Inheritance', 'inheritance', private.setting_numeric('transfers.inheritance_duty', 0), 30),
  ('Amar maxkamadeed', 'Court order', 'court_order', 0, 40);

alter table public.transfers add column type_id uuid references public.transfer_types (id);
create index transfers_type_idx on public.transfers (type_id);
update public.transfers t set type_id = (select y.id from public.transfer_types y where y.works_as = t.kind order by y.sort limit 1);

create function public.transfer_type_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_duty numeric := coalesce(nullif(p ->> 'duty', '')::numeric, 0);
begin
  perform private.assert_permission('valuation.update');
  if v_duty < 0 or v_duty > 1000000 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if v_id is null then
    insert into public.transfer_types (name_so, name_en, works_as, duty, active, created_by)
    values (trim(p ->> 'name_so'), trim(p ->> 'name_en'), (p ->> 'works_as')::public.transfer_kind, round(v_duty, 2),
            coalesce((p ->> 'active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.transfer_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), works_as = (p ->> 'works_as')::public.transfer_kind,
           duty = round(v_duty, 2), active = coalesce((p ->> 'active')::boolean, active)
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'transfer_type');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'transfer_type_taken');
end;
$$;

/** Delete a type no transfer used; one that was used is switched off (old transfers keep their name). */
create function public.transfer_type_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('valuation.update');
  perform 1 from public.transfer_types where id = p_id for update;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'transfer_type');
  end if;
  if exists (select 1 from public.transfers where type_id = p_id) then
    update public.transfer_types set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.transfer_types where id = p_id;
  return 'deleted';
end;
$$;

/** Start a transfer of a chosen type: the type's rules (court order or not) and, on submit, its stamp duty. */
create function public.transfer_create_typed(p_parcel uuid, p_type uuid, p_court_order uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.transfer_types;
  v_id uuid;
begin
  select * into v_type from public.transfer_types where id = p_type and active;
  if v_type.id is null then
    perform private.raise_app_error('VALIDATION', 'transfer_type');
  end if;
  v_id := public.transfer_create(p_parcel, v_type.works_as, null, p_court_order, p_note);
  update public.transfers set type_id = v_type.id where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.transfer_type_save(uuid, jsonb), public.transfer_type_delete(uuid), public.transfer_create_typed(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.transfer_type_save(uuid, jsonb), public.transfer_type_delete(uuid), public.transfer_create_typed(uuid, uuid, uuid, text) to authenticated;

-- On submit, a transfer with a type charges that type's stamp duty.
do $do$
declare
  v text := pg_get_functiondef('public.transfer_submit(uuid)'::regprocedure);
  v_new text := replace(v, E'  if v.kind in (''sale'', ''gift'') then\n    v_duty',
    E'  if v.type_id is not null then\n    v_duty := coalesce((select t.duty from public.transfer_types t where t.id = v.type_id), 0);\n  elsif v.kind in (''sale'', ''gift'') then\n    v_duty');
begin
  if v_new = v then
    raise exception 'transfer_submit: text not found';
  end if;
  execute v_new;
end;
$do$;
