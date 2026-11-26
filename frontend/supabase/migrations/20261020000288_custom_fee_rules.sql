-- Fee types you create can be charged anywhere, with a formula (owner's request, 2026-11-25).
-- On Valuation → Fee types, a fee type that isn't one of the system's own (tax, service charge, stamp duty, …) gets:
-- * charge_on: when it is billed by itself - when land is registered (with its first tax bill), every year (with the
--   yearly property tax), on a transfer (with the stamp duty), when an ID card is printed (with the card bill);
-- * factors: what its amount is multiplied by - land area (m²), width, length, upper storeys, floors, number of units.
--   "0.05 × area × storeys" on 144 m² with 2 storeys = 14.40. A factor the land doesn't have (0 or empty) means no bill.
-- Each fee is billed once per moment (once at registration, once a year, once per transfer or card). When a land's
-- size, type or storeys change, its unpaid bills of these fees are re-billed (never below what was paid).

alter table public.fee_types
  add column if not exists charge_on text[] not null default '{}',
  add column if not exists factors text[] not null default '{}';
alter table public.fee_types drop constraint if exists fee_types_charge_on_check;
alter table public.fee_types add constraint fee_types_charge_on_check
  check (charge_on <@ array['registration', 'yearly', 'transfer', 'id_card']::text[]);
alter table public.fee_types drop constraint if exists fee_types_factors_check;
alter table public.fee_types add constraint fee_types_factors_check
  check (factors <@ array['area', 'width', 'length', 'storeys', 'floors', 'units']::text[]);

/** The system's own fee types: they keep their own flows and never take charge_on or factors. */
create or replace function private.fee_is_built_in(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('property_tax', 'service_charge', 'application_fee', 'certificate_fee', 'transfer_stamp_duty',
                    'building_permit', 'registration_fee', 'property_bill', 'id_card_print');
$$;

/** One of a land's numbers for a fee formula. */
create or replace function private.fee_factor(v public.parcels, p_factor text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_factor
    when 'area' then coalesce(nullif(round(v.plot_width_m * v.plot_length_m, 2), 0), v.area_m2)
    when 'width' then v.plot_width_m
    when 'length' then v.plot_length_m
    when 'storeys' then v.upper_storeys::numeric
    when 'floors' then v.floors::numeric
    when 'units' then greatest(coalesce(v.units, 0),
                               (select count(*) from public.parcels c where c.parent_id = v.id and c.deleted_at is null))::numeric
  end;
$$;

/** A fee's amount for one land and the bill line saying how: {amount, line}. Amount 0 when a factor is missing. */
create or replace function private.fee_amount(p_fee public.fee_types, p_parcel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_amount numeric := p_fee.amount;
  v_line text := p_fee.name_en || ': ' || trim(to_char(p_fee.amount, 'FM9999990.00##')) || ' USD';
  v_f text;
  v_x numeric;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or coalesce(p_fee.amount, 0) <= 0 then
    return jsonb_build_object('amount', 0, 'line', v_line);
  end if;
  foreach v_f in array p_fee.factors loop
    v_x := private.fee_factor(v, v_f);
    if coalesce(v_x, 0) <= 0 then
      return jsonb_build_object('amount', 0, 'line', v_line);
    end if;
    v_amount := v_amount * v_x;
    v_line := v_line || ' × ' || trim(to_char(v_x, 'FM9999990.##')) || case v_f
      when 'area' then ' m²' when 'width' then ' m wide' when 'length' then ' m long'
      when 'storeys' then ' storeys' when 'floors' then ' floors' else ' units' end;
  end loop;
  return jsonb_build_object('amount', round(v_amount, 2), 'line', v_line);
end;
$$;

/** Bill a land the fees set to be charged at this moment, each once per tag. Returns how many bills were made. */
create or replace function private.charge_custom_fees(p_parcel uuid, p_moment text, p_tag text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fee_types;
  a jsonb;
  v_inv uuid;
  v_n int := 0;
begin
  for f in select * from public.fee_types
            where active and not private.fee_is_built_in(code) and p_moment = any (charge_on)
            order by sort, code loop
    if exists (select 1 from public.invoices i where i.parcel_id = p_parcel and i.fee_type_id = f.id
                and i.status <> 'cancelled' and i.note = p_tag) then
      continue;
    end if;
    a := private.fee_amount(f, p_parcel);
    if (a ->> 'amount')::numeric <= 0 then
      continue;
    end if;
    v_inv := private.parcel_raise_invoice(p_parcel, f.code, (a ->> 'amount')::numeric, a ->> 'line', 'fee');
    update public.invoices set note = p_tag where id = v_inv;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

/** When the system raises its own bill for a moment, the fees set for that moment come with it. */
create or replace function private.invoice_custom_fees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.parcel_id is null or new.status = 'cancelled' then
    return null;
  end if;
  select code into v_code from public.fee_types where id = new.fee_type_id;
  if v_code = 'property_bill' and new.run_id is null then
    perform private.charge_custom_fees(new.parcel_id, 'registration', 'auto:registration');
  elsif v_code = 'property_tax' then
    perform private.charge_custom_fees(new.parcel_id, 'yearly', 'auto:yearly:' || private.invoice_bill_year(new.period, new.issue_date));
  elsif v_code = 'transfer_stamp_duty' then
    perform private.charge_custom_fees(new.parcel_id, 'transfer', 'auto:transfer:' || new.id);
  elsif v_code = 'id_card_print' then
    perform private.charge_custom_fees(new.parcel_id, 'id_card', 'auto:id_card:' || new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists custom_fees on public.invoices;
create trigger custom_fees after insert on public.invoices
  for each row execute function private.invoice_custom_fees();

/** A land's size, type or storeys changed: its unpaid bills of formula fees follow (never below what was paid). */
create or replace function private.rebill_custom_fees(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  a jsonb;
  v_to numeric;
begin
  for r in
    select i.*, to_jsonb(f) as fee from public.invoices i join public.fee_types f on f.id = i.fee_type_id
     where i.parcel_id = p_parcel and i.status in ('issued', 'partially_paid')
       and not private.fee_is_built_in(f.code) and cardinality(f.factors) > 0
     for update of i
  loop
    a := private.fee_amount(jsonb_populate_record(null::public.fee_types, r.fee), p_parcel);
    v_to := greatest((a ->> 'amount')::numeric, r.paid + r.credited);
    if v_to <> r.total then
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (r.id, 'fee', 'Re-bill: ' || (a ->> 'line') || ' (was ' || r.total || ' USD)', v_to - r.total, auth.uid());
      update public.invoices set total = v_to where id = r.id;
      perform private.invoice_refresh_status(r.id);
    end if;
  end loop;
end;
$$;

revoke all on function private.fee_is_built_in(text), private.fee_factor(public.parcels, text),
  private.fee_amount(public.fee_types, uuid), private.charge_custom_fees(uuid, text, text),
  private.rebill_custom_fees(uuid) from public, anon, authenticated;

-- Saving a fee type keeps its moments and formula (the system's own fee types never take them).
create or replace function public.valuation_save_fee_type(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_code text;
  v_on text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'charge_on', '[]'::jsonb))), '{}');
  v_factors text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'factors', '[]'::jsonb))), '{}');
begin
  perform private.assert_permission('valuation.update');
  if not v_on <@ array['registration', 'yearly', 'transfer', 'id_card']::text[] then
    perform private.raise_app_error('VALIDATION', 'charge_on');
  end if;
  if not v_factors <@ array['area', 'width', 'length', 'storeys', 'floors', 'units']::text[] then
    perform private.raise_app_error('VALIDATION', 'factors');
  end if;
  if v_id is null then
    v_code := lower(trim(p ->> 'code'));
    insert into public.fee_types (code, name_so, name_en, interval, amount, active, sort, created_by, charge_on, factors)
    values (v_code, trim(p ->> 'name_so'), trim(p ->> 'name_en'), (p ->> 'interval')::public.fee_interval,
            coalesce((p ->> 'amount')::numeric, 0), coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, 100), auth.uid(),
            case when private.fee_is_built_in(v_code) then '{}' else v_on end,
            case when private.fee_is_built_in(v_code) then '{}' else v_factors end)
    returning id into v_id;
  else
    update public.fee_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), interval = (p ->> 'interval')::public.fee_interval,
           amount = coalesce((p ->> 'amount')::numeric, amount), active = coalesce((p ->> 'active')::boolean, active),
           sort = coalesce((p ->> 'sort')::int, sort),
           charge_on = case when private.fee_is_built_in(code) then '{}' when p ? 'charge_on' then v_on else charge_on end,
           factors = case when private.fee_is_built_in(code) then '{}' when p ? 'factors' then v_factors else factors end
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'fee_type');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'code_taken');
end;
$$;

-- A change of size, type or storeys re-bills the formula fees too.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.parcel_update_details(uuid,jsonb)'::regprocedure);
  n := replace(d, $a$    p := p || jsonb_build_object('rebilled', private.rebill_unpaid_tax(p_id));$a$,
                  $b$    p := p || jsonb_build_object('rebilled', private.rebill_unpaid_tax(p_id));
    perform private.rebill_custom_fees(p_id);$b$);
  n := replace(n, $a$    p := p || jsonb_build_object('tax', private.registered_size_rebill(p_id));$a$,
                  $b$    p := p || jsonb_build_object('tax', private.registered_size_rebill(p_id));
    perform private.rebill_custom_fees(p_id);$b$);
  if (length(n) - length(replace(n, 'rebill_custom_fees', ''))) / length('rebill_custom_fees') <> 2 then
    raise exception 'parcel_update_details: anchor not found';
  end if;
  execute n;

  d := pg_get_functiondef('public.parcel_set_upper_storeys(uuid,integer)'::regprocedure);
  n := replace(d, $a$  perform private.parcel_event(p_parcel, 'upper_storeys_changed', null,$a$,
                  $b$  perform private.rebill_custom_fees(p_parcel);
  perform private.parcel_event(p_parcel, 'upper_storeys_changed', null,$b$);
  if n = d then
    raise exception 'parcel_set_upper_storeys: anchor not found';
  end if;
  execute n;
end;
$do$;
