-- When land is registered, the cashiers who work in its district get an in-app notification: a new
-- house to collect from (PUN, house no., neighbourhood, amount due), linking to Cashier → To collect.
-- Only cashiers of that district are told (staff with cashier.create who can access the district;
-- super admins, who see everything anyway, are left out).

create or replace function private.notify_cashiers_of_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due numeric;
  v_nbhd public.neighbourhoods;
  v_place_so text;
  v_place_en text;
begin
  select coalesce(sum(balance), 0) into v_due from public.invoices
   where parcel_id = new.id and status in ('issued', 'partially_paid') and balance > 0;
  select * into v_nbhd from public.neighbourhoods where id = new.neighbourhood_id;
  v_place_so := concat_ws(' · ', new.pun, case when new.house_no is not null then 'Guriga ' || new.house_no end, v_nbhd.name_so);
  v_place_en := concat_ws(' · ', new.pun, case when new.house_no is not null then 'House ' || new.house_no end, v_nbhd.name_en);
  insert into public.notifications (user_id, kind, title_so, title_en, body_so, body_en, link)
  select p.user_id, 'cashier.to_collect',
         'Guri cusub oo lacag laga ururinayo', 'New house to collect from',
         v_place_so || case when v_due > 0 then ' · $' || to_char(v_due, 'FM999999990.00') || ' la bixinayo' else '' end,
         v_place_en || case when v_due > 0 then ' · $' || to_char(v_due, 'FM999999990.00') || ' due' else '' end,
         '/cashier'
    from public.profiles p
   where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
     and not private.user_grants_all(p.user_id)
     and private.user_has_permission(p.user_id, 'cashier.create')
     and private.user_can_access_district(p.user_id, new.district_id);
  return new;
end;
$$;

drop trigger if exists notify_cashiers on public.parcels;
create trigger notify_cashiers after update of status on public.parcels
  for each row when (new.status = 'registered' and old.status is distinct from 'registered')
  execute function private.notify_cashiers_of_parcel();
revoke all on function private.notify_cashiers_of_parcel() from public, anon, authenticated;
