-- ============================================================================
-- 0036 Application fee: an invoice on submit, paid through the normal payment flow.
--
-- Submitting an application with the fee due now raises an "application_fee"
-- invoice. Invoices belong to a parcel, so the application gets its draft parcel
-- at submit: a provisional shape around the GPS pin (sized from the declared plot,
-- hidden from the map) that the survey later replaces. Paying the invoice in full
-- moves the application to survey; waiving the fee, or cancelling/rejecting the
-- application, cancels the unpaid invoice.
-- Also adds a cashier point of sale for Karaan (KRN1) and the "Karaan" spelling.
-- ============================================================================

alter table public.parcels add column geom_provisional boolean not null default false;

/** The application's draft parcel, created from the pin when it doesn't have one yet. */
create function private.application_draft_parcel(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_parcel uuid;
  -- Half the side of a square plot with the declared area (10 m × 10 m when not declared).
  v_half numeric;
begin
  select * into v from public.applications where id = p_app for update;
  if v.parcel_id is not null then
    return v.parcel_id;
  end if;
  select id into v_parcel from public.parcels where application_id = p_app and deleted_at is null;
  if v_parcel is null then
    if v.pin is null then
      return null;
    end if;
    v_half := greatest(least(sqrt(coalesce(v.plot_width_m * v.plot_length_m, 100)) / 2, 100), 2);
    insert into public.parcels (application_id, district_id, neighbourhood_id, plot_no, deed_no, govt_file_no,
                                area_m2, geom, geom_provisional, status, created_by)
    values (v.id, v.district_id, v.neighbourhood_id, v.plot_no, v.old_deed_no, v.govt_file_no,
            v.plot_width_m * v.plot_length_m,
            extensions.st_envelope(extensions.st_buffer(v.pin::extensions.geography, v_half::float8)::extensions.geometry),
            true, 'draft', auth.uid())
    returning id into v_parcel;
    perform private.parcel_event(v_parcel, 'created_for_fee', null, jsonb_build_object('application_id', v.id));
  end if;
  update public.applications set parcel_id = v_parcel where id = p_app;
  return v_parcel;
end;
$$;

/**
 * The application fee invoice: raised once per application (an open or paid one is reused).
 * A zero fee settles straight away. Returns the invoice id, or null when nothing is owed.
 */
create function private.application_fee_invoice(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_fee public.fee_types;
  v_parcel uuid;
  v_inv uuid;
begin
  select * into v from public.applications where id = p_app;
  if v.status <> 'awaiting_payment' or v.fee_status <> 'due' then
    return null;
  end if;
  select * into v_fee from public.fee_types where code = 'application_fee' and active;
  if v_fee.id is null or coalesce(v_fee.amount, 0) <= 0 then
    perform private.application_fee_settled(p_app, 'paid', 'No application fee');
    return null;
  end if;
  v_parcel := private.application_draft_parcel(p_app);
  if v_parcel is null then
    return null;
  end if;
  select id into v_inv from public.invoices
   where parcel_id = v_parcel and fee_type_id = v_fee.id and status <> 'cancelled'
   order by created_at desc limit 1;
  if v_inv is null then
    v_inv := private.raise_fee_invoice(v_parcel, 'application_fee', v_fee.amount, 'Application fee — ' || v.number);
  end if;
  return v_inv;
end;
$$;

-- Submitting raises the fee invoice (same as before otherwise).
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
  v_to := case
    when v.fee_status = 'due' then 'awaiting_payment'
    when exists (select 1 from public.surveys where application_id = p_id and status = 'submitted') then 'surveyed'
    else 'in_survey' end;
  update public.applications
     set status = v_to, submitted_at = coalesce(submitted_at, now()), decision_note = null
   where id = p_id;
  perform private.application_event(p_id, case when v.status = 'returned' then 'resubmitted' else 'submitted' end,
                                    v.status, v_to, null);
  if v_to = 'awaiting_payment' then
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

-- A waiver also cancels the unpaid fee invoice.
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
  if v.status <> 'awaiting_payment' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.applications
     set fee_status = p_status, fee_note = nullif(trim(p_note), ''), fee_decided_by = auth.uid(), status = 'in_survey'
   where id = p_id;
  perform private.application_event(p_id, 'fee_' || p_status::text, 'awaiting_payment', 'in_survey', p_note);
  if p_status = 'waived' and v.parcel_id is not null then
    update public.invoices i
       set status = 'cancelled', cancel_reason = 'Fee waived: ' || coalesce(nullif(trim(p_note), ''), '—')
      from public.fee_types f
     where f.id = i.fee_type_id and f.code = 'application_fee'
       and i.parcel_id = v.parcel_id and i.status = 'issued' and i.paid = 0;
  end if;
end;
$$;

/** Paying the application fee invoice in full moves the application to survey. */
create function private.application_fee_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and exists (select 1 from public.fee_types f where f.id = new.fee_type_id and f.code = 'application_fee') then
    select a.id into v_app from public.applications a join public.parcels p on p.application_id = a.id
     where p.id = new.parcel_id and a.status = 'awaiting_payment' and a.fee_status = 'due';
    if v_app is not null then
      perform private.application_fee_settled(v_app, 'paid', 'Invoice ' || new.number);
    end if;
  end if;
  return new;
end;
$$;
create trigger application_fee_paid after update of status on public.invoices
  for each row execute function private.application_fee_paid();

/** A cancelled or rejected application drops its unpaid fee invoice and its provisional parcel. */
create function private.application_closed_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'rejected') and old.status is distinct from new.status and new.parcel_id is not null then
    update public.invoices i
       set status = 'cancelled', cancel_reason = 'Application ' || new.number || ' ' || new.status::text
      from public.fee_types f
     where f.id = i.fee_type_id and f.code = 'application_fee'
       and i.parcel_id = new.parcel_id and i.status = 'issued' and i.paid = 0;
    update public.parcels set status = 'archived' where id = new.parcel_id and geom_provisional and status = 'draft';
  end if;
  return new;
end;
$$;
create trigger application_closed_cleanup after update of status on public.applications
  for each row execute function private.application_closed_cleanup();

-- The survey's shape replaces the provisional one.
create or replace function private.survey_to_parcel(p_survey public.surveys, p_status public.parcel_status)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  v_app public.applications;
  v_parcel uuid;
  v_developed boolean := coalesce((p_survey.building ->> 'type') not in ('', 'none'), false);
begin
  select * into v_app from public.applications where id = p_survey.application_id;
  select id into v_parcel from public.parcels where application_id = v_app.id;
  if v_parcel is null then
    insert into public.parcels (application_id, district_id, neighbourhood_id, plot_no, deed_no, govt_file_no,
                                area_m2, perimeter_m, geom, status, developed, created_by)
    values (v_app.id, v_app.district_id, v_app.neighbourhood_id, v_app.plot_no, v_app.old_deed_no, v_app.govt_file_no,
            p_survey.area_m2, p_survey.perimeter_m, p_survey.geom, p_status, v_developed, auth.uid())
    returning id into v_parcel;
    update public.applications set parcel_id = v_parcel where id = v_app.id;
  else
    update public.parcels set geom = p_survey.geom, area_m2 = p_survey.area_m2, perimeter_m = p_survey.perimeter_m,
                              status = p_status, developed = v_developed, geom_provisional = false
     where id = v_parcel;
  end if;
  update public.surveys set parcel_id = v_parcel where id = p_survey.id;
  perform private.parcel_event(v_parcel, 'survey_' || p_status::text, null,
    jsonb_build_object('survey_id', p_survey.id, 'area_m2', p_survey.area_m2));
  return v_parcel;
end;
$$;

-- Provisional shapes stay off the map.
create or replace function public.parcel_tile(p_z int, p_x int, p_y int)
returns bytea
language plpgsql
stable
security definer
set search_path = extensions
as $$
declare
  v_env geometry := st_tileenvelope(p_z, p_x, p_y);
  v bytea;
  v_all boolean;
  v_districts uuid[];
begin
  if p_z < 13 or p_z > 22 or not public.has_permission('map.view') then
    return ''::bytea;
  end if;
  v_all := private.user_has_all_districts(auth.uid());
  v_districts := private.user_district_ids(auth.uid());
  select st_asmvt(t.*, 'parcels') into v from (
    select st_asmvtgeom(st_transform(p.geom, 3857), v_env) as geom, p.id::text as id, p.pun, p.status::text as status,
           p.land_use::text as land_use, p.area_m2::float8 as area_m2, p.application_id::text as application_id
    from public.parcels p
    where p.deleted_at is null and p.status <> 'archived' and not p.geom_provisional
      and p.geom && st_transform(v_env, 4326)
      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea);
end;
$$;

/**
 * The application's fee invoice for its page (staff in the district or the applicant):
 * {id, number, total, balance, status, pay_link}, or null.
 */
create function public.application_fee(p_app uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'total', i.total, 'balance', i.balance,
                            'status', i.status, 'pay_link', '/pay/' || t.token)
  from public.applications a
  join public.parcels p on p.id = a.parcel_id
  join public.invoices i on i.parcel_id = p.id and i.status <> 'cancelled'
  join public.fee_types f on f.id = i.fee_type_id and f.code = 'application_fee'
  left join public.invoice_tokens t on t.invoice_id = i.id
  where a.id = p_app and private.can_view_application(a.id)
  order by i.created_at desc
  limit 1;
$$;
revoke all on function public.application_fee(uuid) from public, anon;
grant execute on function public.application_fee(uuid) to authenticated;

revoke all on function private.application_draft_parcel(uuid), private.application_fee_invoice(uuid),
  private.application_fee_paid(), private.application_closed_cleanup() from public, anon, authenticated;

-- Applications already waiting for payment get their invoice now.
do $$
declare
  r record;
begin
  for r in select id from public.applications where status = 'awaiting_payment' and fee_status = 'due' loop
    perform private.application_fee_invoice(r.id);
  end loop;
end;
$$;

-- Karaan: one spelling, and a cashier desk at the district office.
update public.districts set name_en = 'Karaan', name_so = 'Kaaraan' where code = 'KRN';
insert into public.points_of_sale (code, name, district_id, kind, receipt_prefix)
select 'KRN1', 'Karaan district office', d.id, 'cashier', 'KRN1'
  from public.districts d where d.code = 'KRN'
on conflict (code) do nothing;
