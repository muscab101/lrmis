-- Owners page, like Parcels:
-- * owners.registered: see registered owners (every role that sees owners keeps it; an admin can switch it off per role).
-- * owners.delete (partial owners) and owners.delete_registered (registered owners — Admin and Super Admin only).
--   Delete is soft (kept with its reason in the history). An owner who still holds land can't be deleted: delete or
--   transfer the land first.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('owners.registered', 'owners', 'registered', true, 'See registered owners', 'Arag milkiilayaasha la diiwaangeliyay', 362)
on conflict (key) do nothing;
insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('owners.delete_registered', 'owners', 'delete_registered', true, 'Delete registered owners', 'Tirtir milkiilayaasha la diiwaangeliyay', 363)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, 'owners.registered' from public.role_permissions rp join public.roles r on r.id = rp.role_id
 where rp.permission_key = 'owners.view' and not r.is_protected
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['owners.view', 'owners.registered', 'owners.delete', 'owners.delete_registered']) k
 where r.key = 'admin'
on conflict do nothing;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['owners.registered']) x)
 where 'owners.view' = any (default_permissions) and not is_protected;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['owners.view', 'owners.registered', 'owners.delete', 'owners.delete_registered']) x)
 where key = 'admin';

alter table public.parties
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  add column if not exists delete_reason text;
create index if not exists parties_deleted_by_idx on public.parties (deleted_by);

drop policy if exists parties_select on public.parties;
create policy parties_select on public.parties for select to authenticated
  using (
    citizen_user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or ((select public.has_permission('owners.view'))
        and deleted_at is null
        and (district_id is null or public.can_access_district(district_id))
        -- Registered owners only for roles allowed to see them (Admin → Roles: "See registered owners").
        and (registered_at is null or (select public.has_permission('owners.registered'))))
    or exists (select 1 from public.application_parties ap
               where ap.party_id = parties.id and private.can_view_application(ap.application_id))
  );

drop function if exists public.party_delete(uuid);
/** Delete an owner (soft): partial owners with owners.delete, registered owners with owners.delete_registered. */
create function public.party_delete(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parties;
  v_registered boolean;
begin
  v := private.assert_party_in_scope(p_id);
  v_registered := v.registered_at is not null;
  perform private.assert_permission(case when v_registered then 'owners.delete_registered' else 'owners.delete' end);
  if v.citizen_user_id is not null then
    perform private.raise_app_error('CONFLICT', 'citizen_account');
  end if;
  if v_registered and length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  -- Someone who still holds land (or is on an open application) stays.
  if exists (select 1 from public.parcel_owners po join public.parcels p on p.id = po.parcel_id
              where po.party_id = p_id and po.valid_to is null and p.deleted_at is null)
     or exists (select 1 from public.application_parties ap join public.applications a on a.id = ap.application_id
                 where ap.party_id = p_id and a.status not in ('approved', 'rejected', 'cancelled')) then
    perform private.raise_app_error('HAS_RECORDS', 'land');
  end if;
  update public.parties set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id;
end;
$$;
revoke all on function public.party_delete(uuid, text) from public, anon;
grant execute on function public.party_delete(uuid, text) to authenticated;
