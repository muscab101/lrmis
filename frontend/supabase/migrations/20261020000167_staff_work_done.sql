-- "Work done": everything a staff member did on a day, clearly: what they added, changed or removed, which record it
-- was (a parcel's PUN, a bill's number, an owner's name) and, for changes, each field from what to what.

create or replace function public.staff_work_done(p_user uuid, p_day date default null)
returns table (at timestamptz, action text, table_name text, record_id text, label text, parcel_id text, changes jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Mogadishu')::date);
  v_from timestamptz := v_day::timestamp at time zone 'Africa/Mogadishu';
  v_to timestamptz := (v_day + 1)::timestamp at time zone 'Africa/Mogadishu';
begin
  perform private.assert_permission('audit.view');
  return query
  select a.at, a.action, a.table_name, a.record_id,
         left(coalesce(
           r ->> 'pun', r ->> 'number', r ->> 'receipt_no', r ->> 'serial', r ->> 'full_name', r ->> 'name_en',
           r ->> 'name', r ->> 'code',
           (select p.full_name from public.parties p where p.id::text = r ->> 'party_id')), 120),
         case when a.table_name = 'parcels' then a.record_id else r ->> 'parcel_id' end,
         case when a.action = 'update' and a.before is not null and a.after is not null then coalesce((
           select jsonb_agg(jsonb_build_object('f', k.key, 'from', left(a.before ->> k.key, 80), 'to', left(a.after ->> k.key, 80)) order by k.key)
             from jsonb_object_keys(a.after) k(key)
            where a.before -> k.key is distinct from a.after -> k.key
              and k.key not in ('updated_at', 'created_at', 'geom', 'geom_provisional', 'centroid', 'snapshot', 'number_key', 'search')
         ), '[]'::jsonb) else '[]'::jsonb end
    from public.audit_log a
    cross join lateral (select coalesce(a.after, a.before) as r) x
   where a.actor_id = p_user and a.at >= v_from and a.at < v_to
     and a.action not like 'recording.%'
   order by a.at desc
   limit 500;
end;
$$;
grant execute on function public.staff_work_done(uuid, date) to authenticated;
