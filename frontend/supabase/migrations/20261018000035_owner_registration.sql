-- ============================================================================
-- 0035 Owner registration: draft (partial registration) vs registered owners.
--
-- Staff enter owners as drafts; a draft can be viewed, edited or deleted, and
-- moved to the register ("real data") by someone with owners.approve. An owner
-- also becomes registered automatically when they are put on a parcel.
-- (0033/0034 were used by work that was rolled back in the code; the DB keeps them.)
-- ============================================================================

alter table public.parties
  add column registered_at timestamptz,
  add column registered_by uuid references auth.users (id) on delete set null;
create index parties_registered_idx on public.parties (registered_at) where deleted_at is null;
create index parties_registered_by_idx on public.parties (registered_by);

-- Owners already on a parcel, or linked to a citizen account, are registered.
update public.parties p
   set registered_at = coalesce(
         (select min(po.created_at) from public.parcel_owners po where po.party_id = p.id),
         p.created_at)
 where p.registered_at is null
   and (p.citizen_user_id is not null or exists (select 1 from public.parcel_owners po where po.party_id = p.id));

/** Putting an owner on a parcel registers them. */
create function private.register_owner_on_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parties
     set registered_at = now(), registered_by = auth.uid()
   where id = new.party_id and registered_at is null;
  return new;
end;
$$;
create trigger register_owner after insert on public.parcel_owners
  for each row execute function private.register_owner_on_parcel();

/** Staff can only touch owners in their districts (citizen-created ones have no district). */
create function private.assert_party_in_scope(p_id uuid)
returns public.parties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parties;
begin
  select * into v from public.parties where id = p_id and deleted_at is null for update;
  if v is null then
    perform private.raise_app_error('NOT_FOUND', 'party');
  end if;
  if v.district_id is not null and not public.can_access_district(v.district_id) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  return v;
end;
$$;

/**
 * Move a draft owner to the register. Needs a way to identify them: an ID
 * document or a phone number.
 */
create function public.party_register(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parties;
begin
  perform private.assert_permission('owners.approve');
  v := private.assert_party_in_scope(p_id);
  if v.registered_at is not null then
    perform private.raise_app_error('CONFLICT', 'already_registered');
  end if;
  if v.id_number is null and v.phone is null then
    perform private.raise_app_error('VALIDATION', 'identity_required');
  end if;
  update public.parties set registered_at = now(), registered_by = auth.uid() where id = p_id;
end;
$$;

/**
 * Delete a draft owner (soft delete, kept in the audit log). Registered owners and
 * owners named on an application can't be deleted.
 */
create function public.party_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parties;
begin
  perform private.assert_permission('owners.delete');
  v := private.assert_party_in_scope(p_id);
  if v.registered_at is not null or v.citizen_user_id is not null then
    perform private.raise_app_error('CONFLICT', 'registered');
  end if;
  if exists (select 1 from public.application_parties where party_id = p_id)
     or exists (select 1 from public.parcel_owners where party_id = p_id) then
    perform private.raise_app_error('HAS_RECORDS', 'applications');
  end if;
  update public.parties set deleted_at = now() where id = p_id;
end;
$$;

revoke all on function public.party_register(uuid), public.party_delete(uuid) from public, anon;
grant execute on function public.party_register(uuid), public.party_delete(uuid) to authenticated;
revoke all on function private.register_owner_on_parcel(), private.assert_party_in_scope(uuid) from public, anon, authenticated;

-- The Registrar confirms and tidies drafts entered by data-entry and front-desk staff.
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['owners.approve', 'owners.delete']) k
 where r.key = 'registrar'
on conflict do nothing;
update public.roles
   set default_permissions = (select array_agg(distinct x) from unnest(default_permissions || array['owners.approve', 'owners.delete']) x)
 where key = 'registrar';
