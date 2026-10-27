-- Service charge invoices are numbered SCIN-… (owner request 2026-10-27), still sharing the tax bill's number:
-- INV-2026-000018 and SCIN-2026-000018. Existing SV-… numbers are renamed (their journal descriptions follow).
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
     and not exists (select 1 from public.invoices s where s.number = 'SCIN-' || substr(i.number, 5))
   order by i.created_at desc
   limit 1;
  if v_twin is null then
    new.number := 'SCIN-' || substr(new.number, 5);
    return new;
  end if;
  -- The serial just taken for this invoice isn't needed: give it back when it is still the latest one.
  v_year := split_part(new.number, '-', 2);
  update public.serial_counters set last_serial = last_serial - 1
   where scope = 'INV-' || v_year and last_serial = split_part(new.number, '-', 3)::int;
  new.number := 'SCIN-' || substr(v_twin, 5);
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in select id, number from public.invoices where number like 'SV-%' loop
    update public.invoices set number = 'SCIN-' || substr(r.number, 4) where id = r.id;
    update public.journal_entries set memo = replace(memo, r.number, 'SCIN-' || substr(r.number, 4))
     where source in ('invoice', 'invoice_cancel') and source_id = r.id;
  end loop;
end;
$$;
