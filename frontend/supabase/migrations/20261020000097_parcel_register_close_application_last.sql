-- Fix: registering land that was started through an old application failed. Closing the application tells the
-- district's cashiers ("To collect: <PUN>"), so it must happen after the PUN and the bills, not before.

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

  -- The old application closes last: closing it tells the cashiers, which needs the PUN and the bills.
  if v_app.id is not null and v_app.status not in ('approved', 'rejected', 'cancelled') then
    update public.applications set status = 'approved', decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
     where id = v_app.id;
  end if;

  perform private.parcel_event(v.id, 'registered', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Registered'),
    jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'provisional_boundary', v.geom_provisional));
  insert into public.jobs (kind, payload, created_by)
  values ('sms.parcel_registered', jsonb_build_object('parcel_id', v.id, 'pun', v_ids.pun), auth.uid());
  return jsonb_build_object('pun', v_ids.pun, 'account_no', v_ids.account_no, 'parcel_id', v.id);
end;
$$;
