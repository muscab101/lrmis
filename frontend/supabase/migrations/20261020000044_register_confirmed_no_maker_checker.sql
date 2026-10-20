-- ============================================================================
-- 0044 Move to Parcels: the person who created the application may move it.
--
-- 0043 refused when the registrar had created the application (maker-checker).
-- The owner of the system decided against that rule for this action; the
-- other checks stay (✓ site check, submitted, fee settled, no objection).
-- ============================================================================

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
  if v.site_check_status is distinct from 'confirmed' then
    perform private.raise_app_error('CONFLICT', 'site_not_confirmed');
  end if;
  if v.status in ('draft', 'returned') then
    perform private.raise_app_error('CONFLICT', 'not_submitted');
  end if;
  if v.status = 'awaiting_payment' or v.fee_status = 'due' then
    perform private.raise_app_error('CONFLICT', 'fee_due');
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

  -- Work that is no longer needed: open surveys and a running notice.
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
  perform private.parcel_event(v_parcel.id, 'registered', coalesce(nullif(trim(p_note), ''), 'Registered after site check'),
    jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'after_site_check', true,
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
