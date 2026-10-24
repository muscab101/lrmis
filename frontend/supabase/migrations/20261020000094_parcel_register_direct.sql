-- Applications are gone from the app: land in Partial registration is registered straight from the parcel.
-- parcel_register gives it its PUN and account number, raises the tax bill (width × length × the grade's price) and
-- the service charge, and registers its owners. As before, the district's cashiers are told, and the certificate is
-- issued by the system once everything is paid. Land that still has an open application from before is closed with it.

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

/** An invoice on a parcel for one fee, with one line. */
create or replace function private.parcel_raise_invoice(p_parcel uuid, p_fee_code text, p_amount numeric, p_line text, p_kind public.invoice_line_kind)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.fee_types;
  v_inv uuid;
  v_district uuid;
begin
  select * into v_fee from public.fee_types where code = p_fee_code;
  select district_id into v_district from public.parcels where id = p_parcel;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), p_parcel, v_district, v_fee.id,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-' || p_fee_code || '-' || p_parcel),
          current_date, current_date + 30, p_amount, v_fee.name_en || ' — registration', auth.uid())
  returning id into v_inv;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
  values (v_inv, p_kind, p_line, p_amount, auth.uid());
  return v_inv;
end;
$$;

revoke all on function private.parcel_raise_invoice(uuid, text, numeric, text, public.invoice_line_kind) from public, anon, authenticated;
revoke all on function public.parcel_register(uuid, public.land_use, text) from public, anon;
grant execute on function public.parcel_register(uuid, public.land_use, text) to authenticated;
