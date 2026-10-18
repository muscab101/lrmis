-- ============================================================================
-- 0037 Parcels: house number, government receipt, lock / unlock.
--
-- * House No and Govt. Receipt (a paper government receipt number) are typed in
--   on the application and carried to its parcel; staff can edit them on the parcel.
-- * Locking freezes a parcel: its data, geometry and owners can't change, and no
--   transfer or data correction can start, until someone with parcels.lock
--   unlocks it. Bills, payments and certificates carry on.
-- * search_parcels returns the parcels table's new columns.
-- ============================================================================

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('parcels.lock', 'parcels', 'lock', true, 'Lock and unlock parcels', 'Xir oo fur dhulka', 260)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'parcels.lock' from public.roles r where r.key = 'registrar'
on conflict do nothing;
update public.roles set default_permissions = default_permissions || array['parcels.lock']
 where key = 'registrar' and not ('parcels.lock' = any (default_permissions));

alter table public.applications
  add column house_no text check (house_no is null or length(house_no) <= 40),
  add column govt_receipt_no text check (govt_receipt_no is null or length(govt_receipt_no) <= 60);
alter table public.parcels
  add column house_no text check (house_no is null or length(house_no) <= 40),
  add column govt_receipt_no text check (govt_receipt_no is null or length(govt_receipt_no) <= 60),
  add column locked_at timestamptz,
  add column locked_by uuid references auth.users (id) on delete set null,
  add column lock_reason text;
create index parcels_locked_by_idx on public.parcels (locked_by);

-- ---------------------------------------------------------------------------
-- House No / Govt. Receipt follow the application onto its parcel.
-- ---------------------------------------------------------------------------
create function private.parcel_copy_application_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_id is not null and (new.house_no is null or new.govt_receipt_no is null) then
    select coalesce(new.house_no, a.house_no), coalesce(new.govt_receipt_no, a.govt_receipt_no)
      into new.house_no, new.govt_receipt_no
      from public.applications a where a.id = new.application_id;
  end if;
  return new;
end;
$$;
create trigger copy_application_details before insert on public.parcels
  for each row execute function private.parcel_copy_application_details();

create function private.application_details_to_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parcel_id is not null
     and (new.house_no is distinct from old.house_no or new.govt_receipt_no is distinct from old.govt_receipt_no) then
    update public.parcels set house_no = new.house_no, govt_receipt_no = new.govt_receipt_no
     where id = new.parcel_id and locked_at is null;
  end if;
  return new;
end;
$$;
create trigger details_to_parcel after update of house_no, govt_receipt_no on public.applications
  for each row execute function private.application_details_to_parcel();

/** Staff set House No and Govt. Receipt on an application they can edit. */
create function public.application_set_details(p_id uuid, p_house_no text, p_govt_receipt_no text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_edit_application(p_id);
  update public.applications
     set house_no = nullif(trim(p_house_no), ''), govt_receipt_no = nullif(trim(p_govt_receipt_no), '')
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock: nothing about a locked parcel changes except the lock itself.
-- ---------------------------------------------------------------------------
create function private.parcel_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignore text[] := array['locked_at', 'locked_by', 'lock_reason', 'updated_at'];
begin
  if old.locked_at is not null and new.locked_at is not null
     and (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
    perform private.raise_app_error('PARCEL_LOCKED', old.pun);
  end if;
  return new;
end;
$$;
create trigger lock_guard before update on public.parcels
  for each row execute function private.parcel_lock_guard();

/** Rows hanging off a parcel (owners, transfers, data changes) can't be added or changed while it's locked. */
create function private.assert_parcel_unlocked(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pun text;
begin
  select pun into v_pun from public.parcels where id = p_parcel and locked_at is not null;
  if found then
    perform private.raise_app_error('PARCEL_LOCKED', v_pun);
  end if;
end;
$$;

create function private.parcel_child_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'parcel_changes' then
    foreach v_id in array (case when tg_op = 'DELETE' then old.parcel_ids else new.parcel_ids end) loop
      perform private.assert_parcel_unlocked(v_id);
    end loop;
  else
    perform private.assert_parcel_unlocked(case when tg_op = 'DELETE' then old.parcel_id else new.parcel_id end);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger lock_guard before insert or update or delete on public.parcel_owners
  for each row execute function private.parcel_child_lock_guard();
create trigger lock_guard before insert on public.transfers
  for each row execute function private.parcel_child_lock_guard();
create trigger lock_guard before insert on public.parcel_changes
  for each row execute function private.parcel_child_lock_guard();

create function public.parcel_lock(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  perform private.assert_permission('parcels.lock');
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'already_locked');
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  update public.parcels set locked_at = now(), locked_by = auth.uid(), lock_reason = trim(p_reason) where id = p_id;
  perform private.parcel_event(p_id, 'locked', trim(p_reason));
end;
$$;

create function public.parcel_unlock(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  perform private.assert_permission('parcels.lock');
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is null then
    perform private.raise_app_error('CONFLICT', 'not_locked');
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  update public.parcels set locked_at = null, locked_by = null, lock_reason = null where id = p_id;
  perform private.parcel_event(p_id, 'unlocked', trim(p_reason));
end;
$$;

/** Edit the parcel's office details: House No, Govt. Receipt, plot number. p: {house_no, govt_receipt_no, plot_no}. */
create function public.parcel_update_details(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  perform private.assert_permission('parcels.update');
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  update public.parcels
     set house_no = nullif(trim(p ->> 'house_no'), ''),
         govt_receipt_no = nullif(trim(p ->> 'govt_receipt_no'), ''),
         plot_no = nullif(trim(p ->> 'plot_no'), '')
   where id = p_id;
  perform private.parcel_event(p_id, 'details_updated', null,
    jsonb_build_object('house_no', p ->> 'house_no', 'govt_receipt_no', p ->> 'govt_receipt_no', 'plot_no', p ->> 'plot_no'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Parcels table: more columns, and search by house number, receipt or invoice too.
-- ---------------------------------------------------------------------------
drop function public.search_parcels(text, int);
create function public.search_parcels(p_q text, p_limit int default 20)
returns table (id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text,
               created_at timestamptz, house_no text, govt_receipt_no text, invoice text, balance numeric,
               locked_at timestamptz, lock_reason text, application_number text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
          where po.parcel_id = p.id and po.valid_to is null),
         p.created_at, p.house_no, p.govt_receipt_no,
         (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
          order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1),
         (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid')),
         p.locked_at, p.lock_reason, a.number
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.applications a on a.id = p.application_id
  where p.deleted_at is null and p.status <> 'archived'
    and (coalesce(trim(p_q), '') = ''
         or p.pun ilike '%' || trim(p_q) || '%'
         or p.account_no ilike trim(p_q) || '%'
         or p.house_no ilike trim(p_q) || '%'
         or p.govt_receipt_no ilike trim(p_q) || '%'
         or a.number ilike trim(p_q) || '%'
         or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
         or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                    where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%'))
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.parcel_lock(uuid, text), public.parcel_unlock(uuid, text), public.parcel_update_details(uuid, jsonb),
  public.application_set_details(uuid, text, text), public.search_parcels(text, int) from public, anon;
grant execute on function public.parcel_lock(uuid, text), public.parcel_unlock(uuid, text), public.parcel_update_details(uuid, jsonb),
  public.application_set_details(uuid, text, text), public.search_parcels(text, int) to authenticated;
revoke all on function private.parcel_copy_application_details(), private.application_details_to_parcel(), private.parcel_lock_guard(),
  private.assert_parcel_unlocked(uuid), private.parcel_child_lock_guard() from public, anon, authenticated;
