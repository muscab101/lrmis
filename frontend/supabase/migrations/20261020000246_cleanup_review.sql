-- Fixes from the site review (2026-11-15).

-- 1. Billing totals: demolished land's bills are kept as a record and can't be paid, so they are not "open" money.
create or replace function public.billing_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with open_bills as (
    select i.* from public.invoices i
     where i.status in ('issued', 'partially_paid')
       and not exists (select 1 from public.parcels p where p.id = i.parcel_id and p.building_state = 'demolished')
  )
  select jsonb_build_object(
    'runs_waiting', (select count(*) from public.billing_runs where status = 'submitted'),
    'invoices_open', (select count(*) from open_bills),
    'invoices_overdue', (select count(*) from open_bills where due_date < current_date),
    'outstanding', (select coalesce(sum(balance), 0) from open_bills),
    'credit_notes_pending', (select count(*) from public.credit_notes where status = 'pending'),
    'plans_pending', (select count(*) from public.payment_plans where status = 'pending'));
$$;

-- 2. Apartment buildings made before the floor rule (0241): flats get their floor's price type; bills already paid
--    are never lowered, and next year's bills follow the new rule.
do $$
declare
  b uuid;
begin
  for b in
    select distinct u.parent_id from public.parcels u join public.parcels bb on bb.id = u.parent_id
     where bb.layout = 'flats' and bb.deleted_at is null and u.deleted_at is null
       and (u.unit_factor is not null or u.area_m2 is distinct from u.own_m2 or coalesce(u.shared_m2, 0) <> 0
            or u.property_type is distinct from private.flat_grade(u.unit_floor, coalesce(bb.property_type, u.property_type)))
  loop
    perform private.flats_apportion(b);
  end loop;
end $$;

-- 3. Owner records that are not real people and hold nothing: the empty ones made by the old citizen sign-in
--    ("Muwaadin"), and names made only of digits. Marked deleted (kept on record, can be restored).
update public.parties p
   set deleted_at = now(), delete_reason = 'Review clean-up: not a real person, holds no land'
 where p.deleted_at is null
   and ((p.citizen_user_id is not null and p.created_by = p.citizen_user_id) or p.full_name !~ '[[:alpha:]]')
   and not exists (select 1 from public.parcel_owners o where o.party_id = p.id and o.valid_to is null)
   and not exists (select 1 from public.application_parties a where a.party_id = p.id);
