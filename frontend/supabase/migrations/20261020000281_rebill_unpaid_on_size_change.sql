-- A new size or type re-bills the unpaid bills at once (owner's choice, 2026-11-23): when a land's width × length,
-- own m² or type changes in its Edit box, every unpaid tax bill of that land (any year, partial or registered) is set
-- to the new amount, never below what was already paid on it. Paid bills stay as they are (this replaces 0280's
-- "a paid bill reopens for the extra"). Partial land no longer needs the Re-bill button; land with no bill yet gets
-- its first one.

/** Set every unpaid tax bill of a land to its size and type now. Returns the bills changed. */
create or replace function private.rebill_unpaid_tax(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_area numeric;
  v_want numeric;
  v_line text;
  v_to numeric;
  r public.invoices;
  v_done jsonb := '[]'::jsonb;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.layout <> 'house' or v.property_type is null then
    return v_done;
  end if;
  select * into v_grade from public.property_grades where code = v.property_type;
  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);
  v_area := case when v.parent_id is not null then v.area_m2
                 else coalesce(nullif(round(v.plot_width_m * v.plot_length_m, 2), 0), v.area_m2) end;
  if coalesce(v_grade.amount, 0) <= 0 or coalesce(v_area, 0) <= 0 then
    return v_done;
  end if;
  v_want := round(v_area * v_grade.amount, 2);
  v_line := v_grade.name_en || ': ' || trim(to_char(v_area, 'FM9999990.##')) || ' m² × ' || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m²';
  if v.parent_id is null then
    v_want := v_want + private.upper_storeys_amount(v.id);
    v_line := v_line || coalesce(' + ' || private.upper_storeys_line(v.id), '');
  end if;

  -- Land not registered yet with no tax bill at all: its first bill.
  if v.status in ('draft', 'surveyed', 'verified') and not exists (
       select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
        where i.parcel_id = p_parcel and f.code in ('property_bill', 'property_tax') and i.status <> 'cancelled') then
    perform private.parcel_bill(p_parcel);
    return v_done;
  end if;

  for r in
    select i.* from public.invoices i join public.fee_types f on f.id = i.fee_type_id
     where i.parcel_id = p_parcel and f.code in ('property_bill', 'property_tax') and i.status in ('issued', 'partially_paid')
     order by i.issue_date, i.created_at
     for update of i
  loop
    v_to := greatest(v_want, r.paid + r.credited);
    if v_to <> r.total then
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (r.id, 'tax', 'Re-bill: ' || v_line || ' (was ' || r.total || ' USD)', v_to - r.total, auth.uid());
      update public.invoices set total = v_to where id = r.id;
      perform private.invoice_refresh_status(r.id);
      perform private.parcel_event(p_parcel, 'rebilled', null, jsonb_build_object('invoice', r.number, 'from', r.total, 'to', v_to));
      v_done := v_done || jsonb_build_array(jsonb_build_object('invoice', r.number, 'from', r.total, 'to', v_to));
    end if;
  end loop;
  return v_done;
end;
$$;

revoke all on function private.rebill_unpaid_tax(uuid) from public, anon, authenticated;

-- Registered houses (0280) now use it: unpaid bills follow, paid bills stay.
create or replace function private.registered_size_rebill(p_parcel uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('result', 'rebilled', 'bills', private.rebill_unpaid_tax(p_parcel));
$$;

revoke all on function private.registered_size_rebill(uuid) from public, anon, authenticated;

-- Land not registered yet: a new type, width × length or own m² re-bills at once.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.parcel_update_details(uuid,jsonb)'::regprocedure);
  n := replace(d, $a$  -- Land not registered yet: a new size or type is re-billed with the Re-bill button (parcel_rebill_now).$a$,
                  $b$  -- Land not registered yet: a new size or type re-bills its unpaid bills at once.
  if v_partial and ((p ? 'property_type' and v_type is distinct from v.property_type)
       or (v_width is not null and (v_width, v_length) is distinct from (v.plot_width_m, v.plot_length_m))
       or (v_own is not null and v_own is distinct from v.own_m2)) then
    p := p || jsonb_build_object('rebilled', private.rebill_unpaid_tax(p_id));
  end if;$b$);
  if n = d then
    raise exception 'parcel_update_details: anchor not found';
  end if;
  execute n;
end;
$do$;
