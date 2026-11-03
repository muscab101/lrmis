-- The Incomplete page: how much land is left to register, overall, per district and in the neighbourhoods already started.
-- Worked out here because there are thousands of neighbourhoods. A neighbourhood's total is its capacity; remaining is
-- capacity less registered, never below zero, and includes land saved but not registered yet (waiting).
create function public.neighbourhood_remaining(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.has_permission('parcels.yet_to_register') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.yet_to_register');
  end if;
  with places as (
    select n.id, n.code, n.name_so, n.name_en, d.id as district_id, d.name_so as district_so, d.name_en as district_en,
           coalesce(n.capacity, 0)::bigint as total,
           coalesce(l.registered, 0) as registered, coalesce(l.waiting, 0) as waiting, coalesce(a.applications, 0) as applications
      from public.districts d
      join public.neighbourhoods n on n.district_id = d.id and n.deleted_at is null
      left join (
        select p.neighbourhood_id,
               count(*) filter (where p.status in ('registered', 'disputed')) as registered,
               count(*) filter (where p.status in ('draft', 'surveyed', 'verified')) as waiting
          from public.parcels p
         where p.parent_id is null and p.deleted_at is null
         group by p.neighbourhood_id
      ) l on l.neighbourhood_id = n.id
      left join (
        select x.neighbourhood_id, count(*) as applications
          from public.applications x
         where x.status not in ('approved', 'rejected', 'cancelled')
         group by x.neighbourhood_id
      ) a on a.neighbourhood_id = n.id
     where d.deleted_at is null and public.can_access_district(d.id)
  ), worked as (
    select p.*, greatest(p.total - p.registered, 0) as remaining from places p
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'total', coalesce(sum(w.total), 0), 'registered', coalesce(sum(w.registered), 0), 'waiting', coalesce(sum(w.waiting), 0),
        'remaining', coalesce(sum(w.remaining), 0), 'neighbourhoods', count(*),
        'not_started', count(*) filter (where w.registered = 0 and w.waiting = 0 and w.applications = 0),
        'waiting_places', count(*) filter (where w.waiting > 0 or w.applications > 0)) from worked w),
    'districts', (select coalesce(jsonb_agg(x order by x.remaining desc, x.name_en), '[]'::jsonb) from (
        select w.district_id as id, w.district_so as name_so, w.district_en as name_en, sum(w.total) as total, sum(w.registered) as registered,
               sum(w.waiting) as waiting, sum(w.remaining) as remaining, count(*) as neighbourhoods
          from worked w group by w.district_id, w.district_so, w.district_en) x),
    'places', (select coalesce(jsonb_agg(x order by x.waiting desc, x.applications desc, x.registered desc, x.name_en), '[]'::jsonb) from (
        select w.id, w.code, w.name_so, w.name_en, w.district_so, w.district_en, w.total, w.registered, w.waiting, w.applications, w.remaining
          from worked w
         where w.registered > 0 or w.waiting > 0 or w.applications > 0
         order by w.waiting desc, w.applications desc, w.registered desc, w.name_en
         limit least(greatest(coalesce(p_limit, 50), 1), 200)) x))
  into v;
  return v;
end;
$$;
revoke all on function public.neighbourhood_remaining(int) from public, anon;
grant execute on function public.neighbourhood_remaining(int) to authenticated;
