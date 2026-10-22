-- ============================================================================
-- 0052 Two invoices when land is submitted: the property bill and the
-- registration fee.
--
--  * Property bill  = width × length (m²) × the property type's price per m²
--                     (Admin → Property types), converted to USD when in SOS.
--  * Registration fee = a fixed amount (USD 12 to start) for a new registration,
--                     set by admins on Admin → Fees (fee type "registration_fee").
--
-- They replace the single application-fee invoice. The application moves on
-- to survey once all of its invoices are paid (or the fee is waived, which
-- cancels them). A type with a price needs the plot size before submitting.
-- The "storey building / dabaq" type counts as an apartment (flat numbers).
-- ============================================================================

insert into public.fee_types (code, name_so, name_en, interval, amount, active, sort) values
  ('registration_fee', 'Khidmadda diiwaangelinta cusub', 'New registration fee', 'one_off', 12, true, 25),
  ('property_bill', 'Biilka hantida', 'Property bill', 'one_off', 0, true, 26)
on conflict (code) do nothing;

/** The fee types an application's submit can bill (older ones included so their invoices still count). */
create function private.is_application_fee_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('property_bill', 'registration_fee', 'application_fee');
$$;

/** One invoice of a fee type for the application's parcel; an open or paid one is reused. */
create function private.application_raise_invoice(p_app uuid, p_parcel uuid, p_fee_code text, p_amount numeric, p_line text)
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
  values (v_inv, 'fee', p_line, p_amount, auth.uid());
  return v_inv;
end;
$$;

/**
 * Raise the application's invoices on submit (see the header). Returns the first invoice id,
 * or null when nothing is owed (then the application goes straight on to survey).
 */
create or replace function private.application_fee_invoice(p_app uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_type public.property_types;
  v_reg public.fee_types;
  v_area numeric;
  v_bill numeric := 0;
  v_reg_amount numeric := 0;
  v_parcel uuid;
  v_first uuid;
  v_inv uuid;
begin
  select * into v from public.applications where id = p_app;
  if v.status <> 'awaiting_payment' or v.fee_status <> 'due' then
    return null;
  end if;
  if v.property_type is not null then
    select * into v_type from public.property_types where code = v.property_type;
  end if;
  if coalesce(v_type.price, 0) > 0 then
    if v.plot_width_m is null or v.plot_length_m is null then
      perform private.raise_app_error('VALIDATION', 'plot_size_required');
    end if;
    v_area := round(v.plot_width_m * v.plot_length_m, 2);
    v_bill := round(v_area * v_type.price / private.fx_rate_for(v_type.currency, current_date), 2);
  end if;
  if v.type = 'new_registration' then
    select * into v_reg from public.fee_types where code = 'registration_fee';
    if v_reg.id is not null and v_reg.active then
      v_reg_amount := round(coalesce(v_reg.amount, 0), 2);
    end if;
  end if;
  if v_bill + v_reg_amount <= 0 then
    perform private.application_fee_settled(p_app, 'paid', 'Nothing to pay');
    return null;
  end if;
  v_parcel := private.application_draft_parcel(p_app);
  if v_parcel is null then
    return null;
  end if;
  if v_bill > 0 then
    v_first := private.application_raise_invoice(p_app, v_parcel, 'property_bill', v_bill,
      v_type.name_en || ': ' || trim(to_char(v.plot_width_m, 'FM999990.##')) || ' m × ' || trim(to_char(v.plot_length_m, 'FM999990.##'))
        || ' m = ' || trim(to_char(v_area, 'FM9999990.##')) || ' m² × ' || v_type.price || ' ' || v_type.currency || ' per m²');
  end if;
  if v_reg_amount > 0 then
    v_inv := private.application_raise_invoice(p_app, v_parcel, 'registration_fee', v_reg_amount, v_reg.name_en || ' — ' || v.number);
    v_first := coalesce(v_first, v_inv);
  end if;
  return v_first;
end;
$$;

-- A waiver cancels every unpaid fee invoice of the application.
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
     where f.id = i.fee_type_id and private.is_application_fee_code(f.code)
       and i.parcel_id = v.parcel_id and i.status = 'issued' and i.paid = 0;
  end if;
end;
$$;

/** When the last unpaid invoice of the application is paid, it moves on to survey. */
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
     where p.id = new.parcel_id and a.status = 'awaiting_payment' and a.fee_status = 'due';
    if v_app is not null and not exists (
         select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
          where i.parcel_id = new.parcel_id and i.id <> new.id and private.is_application_fee_code(f.code)
            and i.status not in ('paid', 'cancelled')) then
      perform private.application_fee_settled(v_app, 'paid', 'Invoice ' || new.number);
    end if;
  end if;
  return new;
end;
$$;

/** A cancelled or rejected application drops its unpaid fee invoices and its provisional parcel. */
create or replace function private.application_closed_cleanup()
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
     where f.id = i.fee_type_id and private.is_application_fee_code(f.code)
       and i.parcel_id = new.parcel_id and i.status = 'issued' and i.paid = 0;
    update public.parcels set status = 'archived' where id = new.parcel_id and geom_provisional and status = 'draft';
  end if;
  return new;
end;
$$;

/**
 * The application's fee invoices for its page: the one to pay next (id, number, total, balance,
 * status, pay_link), plus all of them in "invoices" and the sums in "total_all" / "balance_all".
 */
create or replace function public.application_fee(p_app uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with inv as (
    select i.id, i.number, i.total, i.balance, i.status, i.created_at, f.code as fee_code, f.name_so, f.name_en,
           '/pay/' || t.token as pay_link
    from public.applications a
    join public.parcels p on p.id = a.parcel_id
    join public.invoices i on i.parcel_id = p.id and i.status <> 'cancelled'
    join public.fee_types f on f.id = i.fee_type_id and private.is_application_fee_code(f.code)
    left join public.invoice_tokens t on t.invoice_id = i.id
    where a.id = p_app and private.can_view_application(a.id)
  ), next as (
    select * from inv order by (balance > 0) desc, created_at limit 1
  )
  select case when exists (select 1 from inv) then
    (select jsonb_build_object('id', n.id, 'number', n.number, 'total', n.total, 'balance', n.balance,
                               'status', n.status, 'pay_link', n.pay_link) from next n)
    || jsonb_build_object(
         'total_all', (select sum(total) from inv),
         'balance_all', (select sum(balance) from inv),
         'invoices', (select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'fee_code', fee_code, 'name_so', name_so,
                                                           'name_en', name_en, 'total', total, 'balance', balance,
                                                           'status', status, 'pay_link', pay_link) order by created_at) from inv))
  end;
$$;

-- "Storey building / dabaq" is a block of flats too.
create or replace function private.is_apartment_type(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is not null and (
    p_code ~* 'apartment|flat|storey|dabaq'
    or exists (select 1 from public.property_types t where t.code = p_code and t.name_en ~* 'apartment|flat|storey|dabaq'));
$$;

revoke all on function private.is_application_fee_code(text), private.application_raise_invoice(uuid, uuid, text, numeric, text)
  from public, anon, authenticated;
