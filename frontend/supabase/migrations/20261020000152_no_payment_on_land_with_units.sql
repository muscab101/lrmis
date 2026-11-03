-- Money goes to a flat or compound house, which holds the bills, never to the land above it (found testing 2026-11-03).
create or replace function private.payment_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parcel_id is not null and exists (select 1 from public.parcels p where p.id = new.parcel_id and p.layout <> 'house') then
    perform private.raise_app_error('CONFLICT', 'land_has_units');
  end if;
  return new;
end;
$$;
create trigger units_guard before insert or update of parcel_id on public.payments
  for each row execute function private.payment_units_guard();
revoke all on function private.payment_units_guard() from public, anon, authenticated;
