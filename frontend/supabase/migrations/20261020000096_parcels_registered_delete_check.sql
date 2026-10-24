-- Parcels page, rebuilt around partial and registered land:
-- * parcels.registered: see registered land (every role that sees parcels keeps it; an admin can switch it off per role).
-- * parcels.delete (partial land) and parcels.delete_registered (registered land — Admin and Super Admin only):
--   delete is soft (kept with its history and reason); land with money received can't be deleted; its unpaid bills
--   are cancelled and its valid documents withdrawn.
-- * Check if it exists: a surveyor of the district visits and confirms the house is there, or reports it isn't;
--   "not found" stops it being registered.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('parcels.registered', 'parcels', 'registered', true, 'See registered land', 'Arag dhulka la diiwaangeliyay', 262)
on conflict (key) do nothing;
insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('parcels.delete_registered', 'parcels', 'delete_registered', true, 'Delete registered land', 'Tirtir dhulka la diiwaangeliyay', 263)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, 'parcels.registered' from public.role_permissions rp join public.roles r on r.id = rp.role_id
 where rp.permission_key = 'parcels.view' and not r.is_protected
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['parcels.view', 'parcels.registered', 'parcels.delete', 'parcels.delete_registered']) k
 where r.key = 'admin'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'parcels.delete' from public.roles r where r.key = 'registrar'
on conflict do nothing;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['parcels.registered']) x)
 where 'parcels.view' = any (default_permissions) and not is_protected;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['parcels.view', 'parcels.registered', 'parcels.delete', 'parcels.delete_registered']) x)
 where key = 'admin';
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['parcels.delete']) x)
 where key = 'registrar';

alter table public.parcels
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists site_check_status text check (site_check_status in ('pending', 'confirmed', 'not_found')),
  add column if not exists site_check_surveyor uuid references auth.users (id) on delete set null,
  add column if not exists site_check_requested_at timestamptz,
  add column if not exists site_check_requested_by uuid references auth.users (id) on delete set null,
  add column if not exists site_check_done_at timestamptz,
  add column if not exists site_check_done_by uuid references auth.users (id) on delete set null,
  add column if not exists site_check_note text;
create index if not exists parcels_site_check_idx on public.parcels (site_check_surveyor) where site_check_status = 'pending';
create index if not exists parcels_deleted_by_idx on public.parcels (deleted_by);
create index if not exists parcels_site_check_requested_by_idx on public.parcels (site_check_requested_by);
create index if not exists parcels_site_check_done_by_idx on public.parcels (site_check_done_by);

create or replace function private.can_view_parcel(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.parcels p
    where p.id = p_id and private.caller_is_active()
      and ((public.has_permission('parcels.view') and public.can_access_district(p.district_id)
            -- Registered land only for roles allowed to see it (Admin → Roles: "See registered land").
            and (p.status not in ('registered', 'disputed') or public.has_permission('parcels.registered')))
           or p.site_check_surveyor = auth.uid()
           or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                      where po.parcel_id = p.id and po.valid_to is null and pa.citizen_user_id = auth.uid())
           or (p.application_id is not null and private.can_view_application(p.application_id))
           -- Surveyors: the land they recorded, and every house in the neighbourhoods of their zones.
           or (public.has_permission('surveys.create')
               and (p.created_by = auth.uid()
                    or exists (select 1 from public.survey_zones z where z.neighbourhood_id = p.neighbourhood_id and z.surveyor_id = auth.uid()))))
  );
$$;

/** Delete land (soft): partial land with parcels.delete, registered land with parcels.delete_registered. */
create or replace function public.parcel_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_registered boolean;
begin
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  v_registered := v.status in ('registered', 'disputed', 'archived');
  perform private.assert_permission(case when v_registered then 'parcels.delete_registered' else 'parcels.delete' end);
  if length(coalesce(trim(p_reason), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  -- Money received stays on the books: such land can't be deleted.
  if exists (select 1 from public.invoices i where i.parcel_id = p_id and i.status <> 'cancelled' and (i.paid > 0 or i.credited > 0))
     or exists (select 1 from public.payments pm where pm.parcel_id = p_id and pm.status <> 'reversed') then
    perform private.raise_app_error('CONFLICT', 'has_payments');
  end if;
  update public.invoices set status = 'cancelled', cancel_reason = 'Land deleted: ' || trim(p_reason)
   where parcel_id = p_id and status not in ('cancelled', 'paid');
  update public.issued_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = 'Land deleted: ' || trim(p_reason)
   where parcel_id = p_id and status = 'valid';
  update public.parcels set deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason) where id = p_id;
  perform private.parcel_event(p_id, 'deleted', trim(p_reason), jsonb_build_object('registered', v_registered));
end;
$$;

/** Check if it exists: send a district surveyor (the least busy, unless one is chosen) to confirm the house is there. */
create or replace function public.parcel_request_site_check(p_id uuid, p_surveyor uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_surveyor uuid := p_surveyor;
  v_label text;
begin
  if not (public.has_permission('parcels.update') or public.has_permission('parcels.approve') or public.has_permission('surveys.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.update');
  end if;
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.site_check_status = 'pending' then
    perform private.raise_app_error('CONFLICT', 'site_check_pending');
  end if;
  if v_surveyor is null then
    select p.user_id into v_surveyor
      from public.profiles p
     where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
       and not private.user_grants_all(p.user_id)
       and private.user_has_permission(p.user_id, 'surveys.create')
       and private.user_can_access_district(p.user_id, v.district_id)
     order by (select count(*) from public.parcels x where x.site_check_surveyor = p.user_id and x.site_check_status = 'pending')
            + (select count(*) from public.applications a where a.site_check_surveyor = p.user_id and a.site_check_status = 'pending'),
              p.full_name
     limit 1;
    if v_surveyor is null then
      perform private.raise_app_error('NOT_FOUND', 'surveyor');
    end if;
  elsif not (private.user_has_permission(v_surveyor, 'surveys.create') and private.user_can_access_district(v_surveyor, v.district_id)) then
    perform private.raise_app_error('VALIDATION', 'not_a_surveyor');
  end if;
  update public.parcels
     set site_check_status = 'pending', site_check_surveyor = v_surveyor, site_check_requested_at = now(),
         site_check_requested_by = auth.uid(), site_check_done_at = null, site_check_done_by = null,
         site_check_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
  v_label := coalesce(v.pun, 'house ' || coalesce(v.house_no, '?'));
  perform private.parcel_event(p_id, 'site_check_requested', nullif(trim(coalesce(p_note, '')), ''), jsonb_build_object('surveyor', v_surveyor));
  perform private.notify(v_surveyor, 'parcel.site_check', 'Hubi in ' || v_label || ' jiro', 'Check that ' || v_label || ' exists', '/surveys?status=site_checks');
  return v_surveyor;
end;
$$;

/** The surveyor (or a survey supervisor) confirms the house exists, or reports it wasn't found (with a note). */
create or replace function public.parcel_confirm_site(p_id uuid, p_exists boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_label text;
begin
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.site_check_status is distinct from 'pending' then
    perform private.raise_app_error('CONFLICT', 'no_site_check');
  end if;
  if not (v.site_check_surveyor = auth.uid() and public.has_permission('surveys.update'))
     and not (public.has_permission('surveys.approve') and public.can_access_district(v.district_id)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'not your site check');
  end if;
  if not p_exists and length(coalesce(trim(p_note), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.parcels
     set site_check_status = case when p_exists then 'confirmed' else 'not_found' end,
         site_check_done_at = now(), site_check_done_by = auth.uid(),
         site_check_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), site_check_note)
   where id = p_id;
  v_label := coalesce(v.pun, 'house ' || coalesce(v.house_no, '?'));
  perform private.parcel_event(p_id, case when p_exists then 'site_confirmed' else 'site_not_found' end, nullif(trim(coalesce(p_note, '')), ''), '{}'::jsonb);
  if v.site_check_requested_by is not null and v.site_check_requested_by <> auth.uid() then
    perform private.notify(v.site_check_requested_by, 'parcel.site_checked',
      case when p_exists then v_label || ' waa jiraa' else v_label || ' lama helin' end,
      case when p_exists then v_label || ' exists' else v_label || ' was not found' end,
      '/parcels/' || p_id);
  end if;
end;
$$;

create or replace function public.parcel_register(p_parcel uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_app public.applications;
  v_ids record;
  v_grade public.property_grades;
  v_service public.fee_types;
  v_tax numeric := 0;
  v_area numeric;
  v_line text;
  f record;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.status not in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  if v.neighbourhood_id is null then
    perform private.raise_app_error('CONFLICT', 'no_location');
  end if;
  -- The site check is optional; a surveyor who found no house there stops it.
  if v.site_check_status = 'not_found' then
    perform private.raise_app_error('CONFLICT', 'site_not_found');
  end if;

  -- An application started before: its owners come onto the parcel and it closes.
  if v.application_id is not null then
    select * into v_app from public.applications where id = v.application_id for update;
    if v_app.status not in ('approved', 'rejected', 'cancelled') then
      if exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id
                 where n.application_id = v_app.id and o.status in ('open', 'upheld')) then
        perform private.raise_app_error('CONFLICT', 'open_objection');
      end if;
      insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
      select v.id, ap.party_id, ap.role, ap.share_pct, v_app.id
        from public.application_parties ap
       where ap.application_id = v_app.id and ap.role in ('owner', 'co_owner', 'heir')
         and not exists (select 1 from public.parcel_owners po where po.parcel_id = v.id and po.party_id = ap.party_id and po.valid_to is null);
      update public.surveys set status = 'cancelled'
       where application_id = v_app.id and status in ('assigned', 'in_progress', 'returned', 'overlap_review');
      update public.public_notices set status = 'closed' where application_id = v_app.id and status = 'open';
      update public.applications set status = 'approved', decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
       where id = v_app.id;
    end if;
  end if;
  if not exists (select 1 from public.parcel_owners po where po.parcel_id = v.id and po.valid_to is null
                   and po.role in ('owner', 'co_owner', 'heir')) then
    perform private.raise_app_error('CONFLICT', 'no_owner');
  end if;

  select * into v_ids from private.next_pun(v.district_id, v.neighbourhood_id);
  update public.parcels
     set pun = v_ids.pun, account_no = v_ids.account_no, status = 'registered', registered_at = now(),
         registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v.id;

  -- The bills: tax (width × length × the grade's price per m²) and the service charge for a new house.
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;
  if coalesce(v_grade.amount, 0) > 0 and v.plot_width_m is not null and v.plot_length_m is not null then
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_tax := round(v_area * v_grade.amount, 2);
    v_line := v_grade.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × '
      || trim(to_char(v.plot_length_m, 'FM999990.##')) || ' m = ' || trim(to_char(v_area, 'FM9999990.##'))
      || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  end if;
  select * into v_service from public.fee_types where code = 'service_charge' and active and coalesce(amount, 0) > 0;
  for f in
    select 'property_bill' code, v_tax amount, v_line line, 'tax'::public.invoice_line_kind kind where v_tax > 0
    union all
    select 'service_charge', round(v_service.amount, 2), coalesce(v_service.name_en, 'Service charge') || ' — ' || v_ids.pun, 'service'
     where v_service.id is not null
  loop
    if not exists (select 1 from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = v.id and ft.code = f.code and i.status <> 'cancelled') then
      perform private.parcel_raise_invoice(v.id, f.code, f.amount, f.line, f.kind);
    end if;
  end loop;

  perform private.parcel_event(v.id, 'registered', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Registered'),
    jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'provisional_boundary', v.geom_provisional));
  insert into public.jobs (kind, payload, created_by)
  values ('sms.parcel_registered', jsonb_build_object('parcel_id', v.id, 'pun', v_ids.pun), auth.uid());
  return jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'parcel_id', v.id);
end;
$$;

revoke all on function public.parcel_delete(uuid, text), public.parcel_request_site_check(uuid, uuid, text), public.parcel_confirm_site(uuid, boolean, text) from public, anon;
grant execute on function public.parcel_delete(uuid, text), public.parcel_request_site_check(uuid, uuid, text), public.parcel_confirm_site(uuid, boolean, text) to authenticated;
