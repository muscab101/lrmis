-- The Parcels tabs' numbers in one pass (2026-11-28): the tabs asked for five counts (partial, registered, owing,
-- demolished, apartment buildings), each reading all 65,000 pieces of land through the access rules — about 2 s on
-- every Parcels page. Now one read counts them all. Runs as the caller, so the numbers are the land they may see,
-- exactly as before (owing: registered houses with an unpaid bill, as parcel_owing_count).

create or replace function public.parcel_stage_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- Unpaid bills read once (not once per house).
  with owing as (
    select distinct i.parcel_id from public.invoices i
     where i.status in ('issued', 'partially_paid') and i.balance > 0
  )
  select jsonb_build_object(
    'draft', count(*) filter (where p.layout = 'house' and p.status in ('draft', 'surveyed', 'verified')),
    'registered', count(*) filter (where p.layout = 'house' and p.status not in ('archived', 'draft', 'surveyed', 'verified')),
    'owing', count(*) filter (where p.layout = 'house' and p.status not in ('archived', 'draft', 'surveyed', 'verified')
                              and o.parcel_id is not null),
    'demolished', count(*) filter (where p.building_state = 'demolished' and p.status <> 'archived'),
    'flats', count(*) filter (where p.layout = 'flats'))
  from public.parcels p
  left join owing o on o.parcel_id = p.id
  where p.deleted_at is null;
$$;
revoke all on function public.parcel_stage_counts() from public, anon;
grant execute on function public.parcel_stage_counts() to authenticated;
