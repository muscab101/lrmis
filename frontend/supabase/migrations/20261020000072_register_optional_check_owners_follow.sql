-- 1. "Check the land exists" is optional: Register no longer needs a confirmed site check. Only a check
--    that found no land blocks it.
-- 2. Owners move to Registered together with their land: an owner is registered when a parcel they
--    own is registered (not as soon as they are put on draft land, as 0035 did), and owners of land
--    already registered are registered now.

create or replace function public.application_register_confirmed(p_id uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_parcel public.parcels;
  v_ids record;
begin
  perform private.assert_permission('parcels.approve');
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status in ('approved', 'rejected', 'cancelled') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  -- The site check is optional; a surveyor who found no land there still stops it.
  if v.site_check_status = 'not_found' then
    perform private.raise_app_error('CONFLICT', 'site_not_found');
  end if;
  if v.status in ('draft', 'returned') then
    perform private.raise_app_error('CONFLICT', 'not_submitted');
  end if;
  if exists (select 1 from public.objections o join public.public_notices n on n.id = o.notice_id
             where n.application_id = p_id and o.status in ('open', 'upheld')) then
    perform private.raise_app_error('CONFLICT', 'open_objection');
  end if;

  perform private.application_draft_parcel(p_id);
  select * into v_parcel from public.parcels where id = (select parcel_id from public.applications where id = p_id) for update;
  if v_parcel.id is null then
    perform private.raise_app_error('CONFLICT', 'no_location');
  end if;

  update public.surveys set status = 'cancelled'
   where application_id = p_id and status in ('assigned', 'in_progress', 'returned', 'overlap_review');
  update public.public_notices set status = 'closed' where application_id = p_id and status = 'open';

  select * into v_ids from private.next_pun(v_parcel.district_id, v_parcel.neighbourhood_id);
  update public.parcels
     set pun = v_ids.pun, account_no = v_ids.account_no, status = 'registered', registered_at = now(),
         registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v_parcel.id;

  insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
  select v_parcel.id, ap.party_id, ap.role, ap.share_pct, p_id
  from public.application_parties ap
  where ap.application_id = p_id and ap.role in ('owner', 'co_owner', 'heir');

  update public.applications set status = 'approved', decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  perform private.parcel_event(v_parcel.id, 'registered', coalesce(nullif(trim(p_note), ''), 'Registered'),
    jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'site_check', v.site_check_status,
                       'provisional_boundary', v_parcel.geom_provisional));
  perform private.application_event(p_id, 'registered_after_site_check', v.status, 'approved', v_ids.pun);
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'parcel.registered',
      'Dhulkaaga waa la diiwaangeliyay: ' || v_ids.pun, 'Your parcel is registered: ' || v_ids.pun,
      '/portal/applications/' || p_id);
  end if;
  insert into public.jobs (kind, payload, created_by)
  values ('sms.parcel_registered', jsonb_build_object('application_id', p_id, 'parcel_id', v_parcel.id, 'pun', v_ids.pun), auth.uid());
  return jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'parcel_id', v_parcel.id,
                            'provisional_boundary', v_parcel.geom_provisional);
end;
$$;

/** An owner put on registered land is registered too (owners of draft land stay in partial registration). */
create or replace function private.register_owner_on_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parties
     set registered_at = now(), registered_by = auth.uid()
   where id = new.party_id and registered_at is null
     and exists (select 1 from public.parcels p where p.id = new.parcel_id and p.status in ('registered', 'disputed'));
  return new;
end;
$$;

/** Land that becomes registered registers its current owners. */
create or replace function private.register_owners_of_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parties pa
     set registered_at = now(), registered_by = auth.uid()
   where pa.registered_at is null
     and pa.id in (select po.party_id from public.parcel_owners po where po.parcel_id = new.id and po.valid_to is null);
  return new;
end;
$$;
drop trigger if exists register_owners on public.parcels;
create trigger register_owners after update of status on public.parcels
  for each row when (new.status = 'registered' and old.status is distinct from 'registered')
  execute function private.register_owners_of_parcel();
revoke all on function private.register_owners_of_parcel() from public, anon, authenticated;

-- Owners of land that is already registered move to Registered now.
update public.parties pa
   set registered_at = now()
 where pa.registered_at is null and pa.deleted_at is null
   and exists (select 1 from public.parcel_owners po join public.parcels p on p.id = po.parcel_id
                where po.party_id = pa.id and po.valid_to is null and p.status in ('registered', 'disputed') and p.deleted_at is null);
