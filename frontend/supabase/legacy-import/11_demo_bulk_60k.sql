-- Up to 60,000 owners (owner's request, 2026-11-28): ~50,000 more made-up DEMO owners with their houses, in every
-- district (shared by how many free roofs each has), every house type, pin = roof centre, bills mixed paid / part / unpaid.
-- Uses private.demo_generate (08_demo_owners.sql), but its roofs come from a list made once (private.demo_roof_pool)
-- instead of searching every roof in the district for each chunk. Work is queued in chunks of 250 owners and run
-- by repeated calls to private.demo_bulk_step() (about 95 seconds of work each). Each step removes, inside its own
-- transaction, the SMS jobs and alerts it made, so nothing is ever sent to the made-up phones.

-- The free roofs of each district, once, in a fixed shuffled order.
create table private.demo_roof_pool as
select d.id district_id, o.id building_id, md5(o.id::text || 'bulk') ord
  from public.districts d join private.building_outlines o
    on o.geom operator(extensions.&&) d.geom and extensions.st_contains(d.geom, o.centre)
 where d.deleted_at is null and o.area_m2 between 30 and 1500
   and not exists (select 1 from private.parcel_roofs pr where pr.building_id = o.id);
create index on private.demo_roof_pool (district_id, ord);
revoke all on private.demo_roof_pool from public, anon, authenticated;

-- demo_generate's roof list now reads:
--   select array_agg(x.building_id order by x.ord) into roofs
--     from (select rp.building_id, rp.ord from private.demo_roof_pool rp
--            where rp.district_id = p_district and not exists (select 1 from private.parcel_roofs pr where pr.building_id = rp.building_id)
--            order by rp.ord limit p_owners * 3) x;

create table private.demo_bulk_queue (
  id serial primary key, district_id uuid not null, owners int not null, start_no int not null,
  done boolean not null default false, result jsonb, finished_at timestamptz);
revoke all on private.demo_bulk_queue from public, anon, authenticated;

-- 49,949 owners shared by free roofs (private.demo_roof_free: free roofs per district), in chunks of 250;
-- numbers follow the last DEMO owner (5288).
insert into private.demo_bulk_queue (district_id, owners, start_no)
select c.district_id, least(250, c.target - g.off), 0
  from (select f.district_id, f.name_en,
               round(49949.0 * f.free_roofs / sum(f.free_roofs) over ())::int target
          from private.demo_roof_free f) c
 cross join lateral generate_series(0, c.target - 1, 250) g(off)
 order by g.off, c.name_en;
update private.demo_bulk_queue q set start_no = 5289 + coalesce(s.before, 0)
  from (select id, sum(owners) over (order by id) - owners before from private.demo_bulk_queue) s where s.id = q.id;

create or replace function private.demo_bulk_step()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5min' as $$
declare
  j private.demo_bulk_queue;
  t0 timestamptz := clock_timestamp();
  n int := 0;
  v jsonb;
begin
  if not pg_try_advisory_xact_lock(424242) then return '{"busy":true}'; end if;
  loop
    exit when clock_timestamp() - t0 > interval '95 seconds';
    select * into j from private.demo_bulk_queue where not done order by id limit 1;
    exit when j.id is null;
    v := private.demo_generate(j.district_id, j.owners, j.start_no);
    update private.demo_bulk_queue set done = true, result = v, finished_at = clock_timestamp() where id = j.id;
    n := n + 1;
  end loop;
  -- Made-up owners get no SMS: removed before this transaction is seen by anyone.
  delete from public.jobs where kind like 'sms.%' and created_at = now();
  delete from public.notifications where created_at = now();
  return jsonb_build_object('chunks', n);
end $$;
revoke all on function private.demo_bulk_step() from public, anon, authenticated;

-- Run until it returns {"chunks": 0}:  select private.demo_bulk_step();
