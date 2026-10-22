-- ============================================================================
-- 0061 The flow as drawn by the owner of the system:
--
--   Survey creates owner + land → on submit the system works out the
--   tax bill (width × length × the grade's price per m²) and, for a new house,
--   the service charge (Valuation → Fee types) and raises the two invoices →
--   the application goes straight to the Applications list (no waiting for
--   payment) → staff check it: "?" sends it back to the survey; corrections to
--   the size or the type of house can be re-billed, which updates the same
--   invoices → ✓ and Move to Parcels registers the land → the district's
--   cashiers are told → the cashier takes the payment → once everything is
--   paid the certificate is created by the system.
-- ============================================================================

update public.fee_types set name_en = 'Tax bill', name_so = 'Biilka canshuurta' where code = 'property_bill';

-- Invoice lines carry their kind (tax / service) so they post to the right income account.
drop function private.application_raise_invoice(uuid, uuid, text, numeric, text);
create function private.application_raise_invoice(p_app uuid, p_parcel uuid, p_fee_code text, p_amount numeric, p_line text,
                                                  p_kind public.invoice_line_kind default 'fee')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.fee_types;
  v_inv uuid;
  v_district uuid;
  v_number text;
begin
  select * into v_fee from public.fee_types where code = p_fee_code;
  select number into v_number from public.applications where id = p_app;
  select id into v_inv from public.invoices
   where parcel_id = p_parcel and fee_type_id = v_fee.id and status <> 'cancelled'
   order by created_at desc limit 1;
  if v_inv is not null then
    return v_inv;
  end if;
  select district_id into v_district from public.parcels where id = p_parcel;
  insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note, created_by)
  values (private.invoice_number(extract(year from current_date)::int), p_parcel, v_district, v_fee.id,
          to_char(current_date, 'YYYY-MM-DD') || '/' || private.next_serial('FEE-' || p_fee_code || '-' || p_parcel),
          current_date, current_date + 30, p_amount, v_fee.name_en || ' — ' || v_number, auth.uid())
  returning id into v_inv;
  insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
  values (v_inv, p_kind, p_line, p_amount, auth.uid());
  return v_inv;
end;
$$;

/** What the application should be billed now: {tax, tax_line, service, service_line}. */
create function private.application_expected_fees(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_grade public.property_grades;
  v_service public.fee_types;
  v_area numeric;
  v_tax numeric := 0;
  v_tax_line text;
  v_svc numeric := 0;
begin
  select * into v from public.applications where id = p_app;
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;
  if coalesce(v_grade.amount, 0) > 0 and v.plot_width_m is not null and v.plot_length_m is not null then
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_tax := round(v_area * v_grade.amount, 2);
    v_tax_line := v_grade.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × '
      || trim(to_char(v.plot_length_m, 'FM999990.##')) || ' m = ' || trim(to_char(v_area, 'FM9999990.##'))
      || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  end if;
  if v.type = 'new_registration' then
    select * into v_service from public.fee_types where code = 'service_charge';
    if v_service.id is not null and v_service.active then
      v_svc := round(coalesce(v_service.amount, 0), 2);
    end if;
  end if;
  return jsonb_build_object('tax', v_tax, 'tax_line', v_tax_line, 'service', v_svc,
                            'service_line', coalesce(v_service.name_en, 'Service charge') || ' — ' || v.number,
                            'needs_size', coalesce(v_grade.amount, 0) > 0 and (v.plot_width_m is null or v.plot_length_m is null));
end;
$$;

/** Raise the tax bill and the service charge on submit. Returns the first invoice id, or null when nothing is owed. */
create or replace function private.application_fee_invoice(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  e jsonb;
  v_parcel uuid;
  v_first uuid;
  v_inv uuid;
begin
  select * into v from public.applications where id = p_app;
  if v.fee_status <> 'due' or v.status in ('draft', 'returned', 'rejected', 'cancelled') then
    return null;
  end if;
  e := private.application_expected_fees(p_app);
  if (e ->> 'needs_size')::boolean then
    perform private.raise_app_error('VALIDATION', 'plot_size_required');
  end if;
  if (e ->> 'tax')::numeric + (e ->> 'service')::numeric <= 0 then
    perform private.application_fee_settled(p_app, 'paid', 'Nothing to pay');
    return null;
  end if;
  v_parcel := private.application_draft_parcel(p_app);
  if v_parcel is null then
    return null;
  end if;
  if (e ->> 'tax')::numeric > 0 then
    v_first := private.application_raise_invoice(p_app, v_parcel, 'property_bill', (e ->> 'tax')::numeric, e ->> 'tax_line', 'tax');
  end if;
  if (e ->> 'service')::numeric > 0 then
    v_inv := private.application_raise_invoice(p_app, v_parcel, 'service_charge', (e ->> 'service')::numeric, e ->> 'service_line', 'service');
    v_first := coalesce(v_first, v_inv);
  end if;
  return v_first;
end;
$$;

/** Fee paid / waived: recorded on the application; it no longer moves the application (payment comes last). */
create or replace function private.application_fee_settled(p_id uuid, p_status public.fee_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  select * into v from public.applications where id = p_id for update;
  if v.status in ('rejected', 'cancelled') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.applications
     set fee_status = p_status, fee_note = nullif(trim(p_note), ''), fee_decided_by = auth.uid(),
         status = case when status = 'awaiting_payment' then 'in_survey'::public.application_status else status end
   where id = p_id;
  perform private.application_event(p_id, 'fee_' || p_status::text, v.status,
    case when v.status = 'awaiting_payment' then 'in_survey'::public.application_status else v.status end, p_note);
  if p_status = 'waived' and v.parcel_id is not null then
    update public.invoices i
       set status = 'cancelled', cancel_reason = 'Fee waived: ' || coalesce(nullif(trim(p_note), ''), '—')
      from public.fee_types f
     where f.id = i.fee_type_id and private.is_application_fee_code(f.code)
       and i.parcel_id = v.parcel_id and i.status = 'issued' and i.paid = 0;
  end if;
  if v.parcel_id is not null then
    perform private.try_auto_certificate(v.parcel_id);
  end if;
end;
$$;

/** The certificate is created by the system once the land is registered and nothing is owed. */
create function private.try_auto_certificate(p_parcel uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert uuid;
  r record;
begin
  if cardinality(private.certificate_blockers(p_parcel)) > 0
     or exists (select 1 from public.issued_documents where parcel_id = p_parcel and type = 'certificate' and status = 'valid') then
    return null;
  end if;
  v_cert := private.issue_document('certificate', p_parcel, null, null);
  for r in select po.party_id from public.parcel_owners po where po.parcel_id = p_parcel and po.valid_to is null
           and not exists (select 1 from public.issued_documents d where d.parcel_id = p_parcel and d.party_id = po.party_id
                           and d.type = 'id_card' and d.status = 'valid') loop
    perform private.issue_document('id_card', p_parcel, r.party_id, null);
  end loop;
  perform private.parcel_event(p_parcel, 'certificate_auto_issued', 'Paid in full', jsonb_build_object('document_id', v_cert));
  return v_cert;
end;
$$;

/** Paying the last open invoice of an application settles its fee; a registered parcel then gets its certificate. */
create or replace function private.application_fee_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and exists (select 1 from public.fee_types f where f.id = new.fee_type_id and private.is_application_fee_code(f.code)) then
    select a.id into v_app from public.applications a join public.parcels p on p.application_id = a.id
     where p.id = new.parcel_id and a.fee_status = 'due' and a.status not in ('rejected', 'cancelled');
    if v_app is not null and not exists (
         select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
          where i.parcel_id = new.parcel_id and i.id <> new.id and private.is_application_fee_code(f.code)
            and i.status not in ('paid', 'cancelled')) then
      perform private.application_fee_settled(v_app, 'paid', 'Invoice ' || new.number);
    elsif v_app is null then
      perform private.try_auto_certificate(new.parcel_id);
    end if;
  end if;
  return new;
end;
$$;

/** When land is registered: tell the district's cashiers, and issue the certificate if nothing is owed. */
create function private.application_registered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcel public.parcels;
  v_owed numeric;
  r record;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.parcel_id is not null then
    select * into v_parcel from public.parcels where id = new.parcel_id;
    select coalesce(sum(balance), 0) into v_owed from public.invoices
     where parcel_id = new.parcel_id and status in ('issued', 'partially_paid');
    if v_owed > 0 then
      -- Cashiers of that district only (people with access to every district are told only if no one else is).
      for r in
        with cashiers as (
          select p.user_id, private.user_has_all_districts(p.user_id) as everywhere
          from public.profiles p
          where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
            and private.user_has_permission(p.user_id, 'payments.create')
            and private.user_can_access_district(p.user_id, v_parcel.district_id))
        select user_id from cashiers
         where not everywhere or not exists (select 1 from cashiers c where not c.everywhere)
      loop
        perform private.notify(r.user_id, 'cashier.parcel_registered',
          'Lacag bixin: ' || v_parcel.pun || ' (' || v_owed || ' USD)', 'To collect: ' || v_parcel.pun || ' (USD ' || v_owed || ')',
          '/cashier?find=' || v_parcel.pun);
      end loop;
    end if;
    perform private.try_auto_certificate(new.parcel_id);
  end if;
  return new;
end;
$$;
create trigger application_registered after update of status on public.applications
  for each row execute function private.application_registered();

/** Staff correct the size or the type of house after checking (re-bill afterwards). */
create function public.application_correct_land(p_id uuid, p_width numeric, p_length numeric, p_property_type text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  perform private.assert_permission('applications.update');
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status in ('draft', 'returned', 'approved', 'rejected', 'cancelled') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if (p_width is not null and p_width <= 0) or (p_length is not null and p_length <= 0) then
    perform private.raise_app_error('VALIDATION', 'plot_size');
  end if;
  update public.applications
     set plot_width_m = p_width, plot_length_m = p_length, property_type = nullif(trim(p_property_type), '')
   where id = p_id;
  perform private.application_event(p_id, 'land_corrected', v.status, v.status,
    concat_ws(' · ', case when p_width is not null and p_length is not null then p_width || ' × ' || p_length || ' m' end,
              'type ' || nullif(trim(p_property_type), ''), nullif(trim(p_note), '')));
  return private.application_expected_fees(p_id);
end;
$$;

/** Re-bill: bring the application's invoices in line with its size and type now (the same invoices are updated). */
create function public.application_rebill(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  e jsonb;
  v_parcel uuid;
  r record;
  v_inv public.invoices;
  v_want numeric;
  v_changed int := 0;
begin
  perform private.assert_permission('applications.update');
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status in ('draft', 'returned', 'rejected', 'cancelled') or v.fee_status = 'waived' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  e := private.application_expected_fees(p_id);
  if (e ->> 'needs_size')::boolean then
    perform private.raise_app_error('VALIDATION', 'plot_size_required');
  end if;
  v_parcel := private.application_draft_parcel(p_id);
  if v_parcel is null then
    v_parcel := v.parcel_id;
  end if;
  for r in select * from (values ('property_bill', 'tax_line', 'tax', 'tax'::public.invoice_line_kind),
                                 ('service_charge', 'service_line', 'service', 'service'::public.invoice_line_kind)) t(code, line_key, amt_key, kind) loop
    v_want := (e ->> r.amt_key)::numeric;
    select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
     where i.parcel_id = v_parcel and f.code = r.code and i.status <> 'cancelled' order by i.created_at desc limit 1;
    if v_inv.id is null then
      if v_want > 0 then
        perform private.application_raise_invoice(p_id, v_parcel, r.code, v_want, e ->> r.line_key, r.kind);
        v_changed := v_changed + 1;
      end if;
    elsif v_inv.total <> v_want then
      if v_want < v_inv.paid + v_inv.credited then
        perform private.raise_app_error('CONFLICT', 'rebill_below_paid');
      end if;
      if v_want = 0 and v_inv.paid = 0 then
        update public.invoices set status = 'cancelled', cancel_reason = 'Re-billed: nothing to pay' where id = v_inv.id;
      else
        insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
        values (v_inv.id, r.kind, 'Re-bill: ' || coalesce(e ->> r.line_key, r.code) || ' (was ' || v_inv.total || ' USD)',
                v_want - v_inv.total, auth.uid());
        update public.invoices set total = v_want where id = v_inv.id;
        perform private.invoice_refresh_status(v_inv.id);
      end if;
      v_changed := v_changed + 1;
    end if;
    v_inv := null;
  end loop;
  -- Something to pay again after "nothing to pay".
  if v_changed > 0 and v.fee_status = 'paid' and exists (
       select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
        where i.parcel_id = v_parcel and private.is_application_fee_code(f.code) and i.status in ('issued', 'partially_paid')) then
    update public.applications set fee_status = 'due' where id = p_id;
  end if;
  perform private.application_event(p_id, 'rebilled', v.status, v.status,
    'tax ' || (e ->> 'tax') || ' USD · service ' || (e ->> 'service') || ' USD');
  return e || jsonb_build_object('changed', v_changed);
end;
$$;

/**
 * The application's fee invoices for its page: the one to pay next (id, number, total, balance, status,
 * pay_link), all of them in "invoices", the sums, and "expected" / "needs_rebill" for the Re-bill button.
 */
create or replace function public.application_fee(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.applications;
  e jsonb;
  v_out jsonb;
  v_invoices jsonb;
  v_tax numeric;
  v_svc numeric;
begin
  select * into v from public.applications where id = p_app;
  if v.id is null or not private.can_view_application(p_app) then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'fee_code', f.code, 'name_so', f.name_so,
                                               'name_en', f.name_en, 'total', i.total, 'balance', i.balance, 'status', i.status,
                                               'pay_link', '/pay/' || t.token) order by i.created_at), '[]')
    into v_invoices
  from public.invoices i
  join public.fee_types f on f.id = i.fee_type_id and private.is_application_fee_code(f.code)
  left join public.invoice_tokens t on t.invoice_id = i.id
  where v.parcel_id is not null and i.parcel_id = v.parcel_id and i.status <> 'cancelled';
  e := private.application_expected_fees(p_app);
  select coalesce(sum((x ->> 'total')::numeric), 0) into v_tax from jsonb_array_elements(v_invoices) x where x ->> 'fee_code' = 'property_bill';
  select coalesce(sum((x ->> 'total')::numeric), 0) into v_svc from jsonb_array_elements(v_invoices) x where x ->> 'fee_code' = 'service_charge';
  if jsonb_array_length(v_invoices) = 0 and (e ->> 'tax')::numeric + (e ->> 'service')::numeric = 0 then
    return null;
  end if;
  select x into v_out from jsonb_array_elements(v_invoices) x order by ((x ->> 'balance')::numeric > 0) desc limit 1;
  return coalesce(v_out - 'fee_code' - 'name_so' - 'name_en', '{}'::jsonb) || jsonb_build_object(
    'total_all', (select coalesce(sum((x ->> 'total')::numeric), 0) from jsonb_array_elements(v_invoices) x),
    'balance_all', (select coalesce(sum((x ->> 'balance')::numeric), 0) from jsonb_array_elements(v_invoices) x),
    'invoices', v_invoices,
    'expected', e,
    'needs_rebill', v.status not in ('draft', 'returned', 'rejected', 'cancelled') and v.fee_status <> 'waived'
                    and not (e ->> 'needs_size')::boolean
                    and (v_tax <> (e ->> 'tax')::numeric or v_svc <> (e ->> 'service')::numeric));
end;
$$;

create or replace function public.application_submit(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications := private.assert_can_edit_application(p_id);
  v_problems jsonb := public.application_checklist(p_id);
  v_to public.application_status;
  v_inv uuid;
begin
  if jsonb_array_length(v_problems) > 0 then
    perform private.raise_app_error('VALIDATION', 'checklist');
  end if;
  -- No waiting for payment: the invoices are raised now and paid after registration.
  v_to := case
    when exists (select 1 from public.surveys where application_id = p_id and status = 'submitted') then 'surveyed'
    else 'in_survey' end;
  update public.applications
     set status = v_to, submitted_at = coalesce(submitted_at, now()), decision_note = null
   where id = p_id;
  perform private.application_event(p_id, case when v.status = 'returned' then 'resubmitted' else 'submitted' end,
                                    v.status, v_to, null);
  if v.fee_status = 'due' then
    v_inv := private.application_fee_invoice(p_id);
  end if;
  if v.citizen_user_id is not null then
    perform private.notify(v.citizen_user_id, 'application.submitted',
      'Codsigaaga ' || v.number || ' waa la gudbiyay', 'Your application ' || v.number || ' was submitted',
      '/portal/applications/' || p_id);
  end if;
  insert into public.jobs (kind, payload, created_by)
  values ('sms.application_submitted', jsonb_build_object('application_id', p_id, 'number', v.number), auth.uid());
  return jsonb_build_object('number', v.number, 'status', (select status from public.applications where id = p_id), 'invoice_id', v_inv);
end;
$$;


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
  -- Payment comes after registration now (the cashier is told, the certificate follows payment).
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


create or replace function public.application_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_parcels uuid[];
  v_invoices uuid[];
  v_surveys uuid[];
  v_parties uuid[];
  v_party uuid;
begin
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if not (v.citizen_user_id = auth.uid()
          or (v.created_by = auth.uid() and v.citizen_user_id is null and not private.caller_is_staff())) then
    perform private.assert_permission('applications.cancel');
  end if;
  -- Anything not yet registered; surveyed land and paid invoices are refused below.
  if v.status = 'approved' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;

  select coalesce(array_agg(id), '{}') into v_parcels from public.parcels
   where id = v.parcel_id or application_id = p_id;
  if exists (select 1 from public.parcels where id = any (v_parcels)
             and (status = 'registered' or registered_at is not null or not geom_provisional)) then
    perform private.raise_app_error('CONFLICT', 'application_land_registered');
  end if;
  select coalesce(array_agg(id), '{}') into v_invoices from public.invoices where parcel_id = any (v_parcels);
  if exists (select 1 from public.payment_allocations where invoice_id = any (v_invoices))
     or exists (select 1 from public.payments where parcel_id = any (v_parcels))
     or exists (select 1 from public.invoices where id = any (v_invoices) and paid > 0) then
    perform private.raise_app_error('CONFLICT', 'application_paid');
  end if;

  -- The owners on it (removed at the end unless they're used elsewhere).
  select coalesce(array_agg(distinct x), '{}') into v_parties from (
    select party_id as x from public.application_parties where application_id = p_id
    union select v.applicant_party_id where v.applicant_party_id is not null) s;

  -- Surveys and notices of the application or its land.
  select coalesce(array_agg(id), '{}') into v_surveys from public.surveys where application_id = p_id or parcel_id = any (v_parcels);
  delete from public.survey_photos where survey_id = any (v_surveys);
  delete from public.surveys where id = any (v_surveys);
  delete from public.public_notices where application_id = p_id or parcel_id = any (v_parcels);

  -- The land's invoices (lines and pay links go with them) and other land records.
  delete from public.payment_intents where invoice_id = any (v_invoices);
  delete from public.invoices where id = any (v_invoices);
  delete from public.parcel_owners where parcel_id = any (v_parcels) or source_application_id = p_id;
  delete from public.buildings where parcel_id = any (v_parcels);
  delete from public.exemptions where parcel_id = any (v_parcels);
  delete from public.parcel_history where parcel_id = any (v_parcels);
  update public.applications set parcel_id = null where id = p_id;
  delete from public.parcels where id = any (v_parcels);

  -- The application (documents, events and owner links cascade).
  delete from public.applications where id = p_id;

  foreach v_party in array v_parties loop
    if not exists (select 1 from public.application_parties where party_id = v_party)
       and not exists (select 1 from public.applications where applicant_party_id = v_party)
       and not exists (select 1 from public.parcel_owners where party_id = v_party)
       and not exists (select 1 from public.issued_documents where party_id = v_party)
       and not exists (select 1 from public.leases where lessee_party_id = v_party) then
      delete from public.parties where id = v_party;
    end if;
  end loop;
end;
$$;

create or replace function public.application_transition(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_to public.application_status;
  v_is_applicant boolean;
begin
  select * into v from public.applications where id = p_id;
  if v is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  v_is_applicant := v.citizen_user_id = auth.uid() or (v.created_by = auth.uid() and v.citizen_user_id is null and not private.caller_is_staff());

  case p_action
    when 'return' then
      perform private.assert_permission('applications.update');
      if v.status not in ('awaiting_payment', 'in_survey', 'surveyed', 'in_verification') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      v_to := 'returned';
    when 'reject' then
      perform private.assert_permission('applications.approve');
      if v.status in ('draft', 'approved', 'rejected', 'cancelled') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      perform private.assert_maker_checker(v.created_by);
      v_to := 'rejected';
    when 'cancel' then
      if not v_is_applicant then
        perform private.assert_permission('applications.cancel');
      end if;
      -- Submitted applications go straight to review now, so they can still be cancelled there.
      if v.status not in ('draft', 'awaiting_payment', 'returned', 'in_survey') then
        perform private.raise_app_error('CONFLICT', 'status');
      end if;
      v_to := 'cancelled';
    else
      perform private.raise_app_error('VALIDATION', 'action');
  end case;

  if p_action in ('return', 'reject') then
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    if not public.can_access_district(v.district_id) then
      perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
    end if;
  end if;

  update public.applications
     set status = v_to,
         decision_note = nullif(trim(p_note), ''),
         decided_at = case when v_to in ('rejected', 'cancelled') then now() else decided_at end
   where id = p_id;
  perform private.application_event(p_id, p_action, v.status, v_to, p_note);
  if v.citizen_user_id is not null and v.citizen_user_id <> auth.uid() then
    perform private.notify(v.citizen_user_id, 'application.' || p_action,
      'Codsigaaga ' || v.number || ': ' || p_action, 'Your application ' || v.number || ': ' || p_action,
      '/portal/applications/' || p_id);
  end if;
end;
$$;

revoke all on function private.application_raise_invoice(uuid, uuid, text, numeric, text, public.invoice_line_kind),
  private.application_expected_fees(uuid), private.try_auto_certificate(uuid), private.application_registered()
  from public, anon, authenticated;
revoke all on function public.application_correct_land(uuid, numeric, numeric, text, text), public.application_rebill(uuid) from public, anon;
grant execute on function public.application_correct_land(uuid, numeric, numeric, text, text), public.application_rebill(uuid) to authenticated;
