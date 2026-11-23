-- Edit registered land like partial land (owner's request, 2026-11-23): a registered house's land type and width ×
-- length can now be changed in the land's Edit box (flats, compounds and their units stay fixed). This year's tax bill
-- follows at once (owner's choice): the difference goes on this year's tax bill as a line (one tax bill per land per
-- year stays the rule, so a bill already paid gets the extra line and shows it as owed). A smaller size lowers the bill,
-- never below what was paid; money already paid is not refunded automatically. With no tax bill this year yet, the
-- yearly run bills the new size.

/** Bring this year's tax bill of a registered house in line with its size and type now. Returns what was done. */
create or replace function private.registered_size_rebill(p_parcel uuid)
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
  v_have numeric;
  v_d numeric;
  v_inv public.invoices;
  v_line text;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.layout <> 'house' or v.parent_id is not null or v.property_type is null then
    return null;
  end if;
  select * into v_grade from public.property_grades where code = v.property_type;
  v_grade.amount := private.grade_price_here(v_grade.id, v.neighbourhood_id, v_grade.amount);
  v_area := coalesce(nullif(round(v.plot_width_m * v.plot_length_m, 2), 0), v.area_m2);
  if coalesce(v_grade.amount, 0) <= 0 or coalesce(v_area, 0) <= 0 then
    return null;
  end if;
  v_want := round(v_area * v_grade.amount, 2) + private.upper_storeys_amount(p_parcel);
  select coalesce(sum(i.total - i.credited), 0) into v_have
    from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = p_parcel and f.code in ('property_bill', 'property_tax') and i.status <> 'cancelled'
     and extract(year from i.issue_date) = extract(year from now());
  if v_have = 0 then
    return jsonb_build_object('result', 'no_bill_this_year');
  end if;
  v_d := v_want - v_have;
  if v_d = 0 then
    return jsonb_build_object('result', 'unchanged');
  end if;
  v_line := 'Size or type corrected: ' || trim(to_char(v_area, 'FM9999990.##')) || ' m² × '
            || trim(to_char(v_grade.amount, 'FM9999990.00')) || ' USD per m² (' || v_grade.name_en || ')';

  select i.* into v_inv from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = p_parcel and f.code in ('property_bill', 'property_tax') and i.status <> 'cancelled'
     and extract(year from i.issue_date) = extract(year from now())
   order by (i.status in ('issued', 'partially_paid')) desc, i.issue_date desc, i.created_at desc limit 1;
  if v_inv.id is not null and v_inv.total + v_d >= v_inv.paid + v_inv.credited then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v_inv.id, 'tax', v_line, v_d, auth.uid());
    update public.invoices set total = total + v_d where id = v_inv.id;
    perform private.invoice_refresh_status(v_inv.id);
    return jsonb_build_object('result', 'bill_changed', 'invoice', v_inv.number, 'difference', v_d);
  end if;
  -- Smaller, and this year's bill is already paid: nothing more is owed; the office decides about any refund.
  return jsonb_build_object('result', 'paid_more', 'difference', v_d);
end;
$$;

revoke all on function private.registered_size_rebill(uuid) from public, anon, authenticated;

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.parcel_update_details(uuid,jsonb)'::regprocedure);
  -- Registered flats, compounds and units keep their size; a registered house may change.
  n := replace(d, $a$  if not v_partial and ((p ? 'property_type' and v_type is distinct from v.property_type)$a$,
                  $b$  if not v_partial and (v.layout <> 'house' or v.parent_id is not null) and ((p ? 'property_type' and v_type is distinct from v.property_type)$b$);
  -- After the change: the recorded area follows width × length, and this year's tax bill follows the new size or type.
  n := replace(n, $a$  -- Land not registered yet: a new size or type is re-billed with the Re-bill button (parcel_rebill_now).$a$,
                  $b$  -- Registered house: the recorded area follows width × length, and this year's tax bill follows at once.
  if not v_partial and v.layout = 'house' and v.parent_id is null
     and ((p ? 'property_type' and v_type is distinct from v.property_type)
          or (v_width is not null and (v_width, v_length) is distinct from (v.plot_width_m, v.plot_length_m))) then
    update public.parcels set area_m2 = round(plot_width_m * plot_length_m, 2)
     where id = p_id and plot_width_m > 0 and plot_length_m > 0;
    p := p || jsonb_build_object('tax', private.registered_size_rebill(p_id));
  end if;

  -- Land not registered yet: a new size or type is re-billed with the Re-bill button (parcel_rebill_now).$b$);
  if n = d or position('private.registered_size_rebill(p_id)' in n) = 0 or position($c$(v.layout <> 'house' or v.parent_id is not null)$c$ in n) = 0 then
    raise exception 'parcel_update_details: anchor not found';
  end if;
  execute n;
end;
$do$;
