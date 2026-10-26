-- Service charge invoices are numbered SV-…, everything else stays INV-…. A service charge raised for the same land as
-- its tax bill takes the tax bill's number: INV-2026-000018 (tax bill) and SV-2026-000018 (service charge). Without a
-- tax bill to pair with, it keeps its own serial (SV and INV share one series, so numbers never clash). Existing
-- service charges are renumbered the same way (their journal descriptions follow).

/** Before a service charge is saved: SV- with its tax bill's number, or its own. */
create or replace function private.service_charge_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_twin text;
  v_year text;
begin
  if new.number not like 'INV-%' or not exists (select 1 from public.fee_types where id = new.fee_type_id and code = 'service_charge') then
    return new;
  end if;
  select i.number into v_twin
    from public.invoices i join public.fee_types f on f.id = i.fee_type_id
   where i.parcel_id = new.parcel_id and f.code = 'property_bill' and i.status <> 'cancelled' and i.number like 'INV-%'
     and not exists (select 1 from public.invoices s where s.number = 'SV-' || substr(i.number, 5))
   order by i.created_at desc
   limit 1;
  if v_twin is null then
    new.number := 'SV-' || substr(new.number, 5);
    return new;
  end if;
  -- The serial just taken for this invoice isn't needed: give it back when it is still the latest one.
  v_year := split_part(new.number, '-', 2);
  update public.serial_counters set last_serial = last_serial - 1
   where scope = 'INV-' || v_year and last_serial = split_part(new.number, '-', 3)::int;
  new.number := 'SV-' || substr(v_twin, 5);
  return new;
end;
$$;
revoke all on function private.service_charge_number() from public, anon, authenticated;
create trigger service_charge_number before insert on public.invoices for each row execute function private.service_charge_number();

-- Existing service charges.
do $$
declare
  r record;
  v_new text;
begin
  for r in select i.id, i.number, i.parcel_id from public.invoices i join public.fee_types f on f.id = i.fee_type_id
            where f.code = 'service_charge' and i.number like 'INV-%' order by i.created_at loop
    select 'SV-' || substr(t.number, 5) into v_new
      from public.invoices t join public.fee_types f on f.id = t.fee_type_id
     where t.parcel_id = r.parcel_id and f.code = 'property_bill' and t.number like 'INV-%'
       and not exists (select 1 from public.invoices s where s.number = 'SV-' || substr(t.number, 5))
     order by (t.status = 'cancelled'), t.created_at desc
     limit 1;
    if v_new is null or exists (select 1 from public.invoices where number = v_new) then
      v_new := 'SV-' || substr(r.number, 5);
    end if;
    update public.invoices set number = v_new where id = r.id;
    update public.journal_entries set memo = replace(memo, r.number, v_new)
     where source in ('invoice', 'invoice_cancel') and source_id = r.id;
  end loop;
end;
$$;
