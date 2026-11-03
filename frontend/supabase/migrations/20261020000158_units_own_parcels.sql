-- Every flat or compound house is its own parcel in the land list, one row per owner, as its bills already are:
-- the land above them isn't listed, and each one registers on its own. A building can still register all at once.
create or replace function public.search_parcels(p_q text, p_limit int default 20)
returns table (id uuid, pun text, status public.parcel_status, area_m2 numeric, district text, neighbourhood text, owners text,
               created_at timestamptz, house_no text, govt_receipt_no text, invoice text, balance numeric,
               locked_at timestamptz, lock_reason text, application_number text, district_en text, neighbourhood_en text, plot_no text,
               building_state text, parent_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.pun, p.status, p.area_m2, d.name_so, n.name_so,
         coalesce(
           (select string_agg(distinct pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
              join public.parcels o on o.id = po.parcel_id
             where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null and o.status <> 'archived')) and po.valid_to is null),
           (select string_agg(pa.full_name, ', ' order by ap.share_pct desc nulls last) from public.application_parties ap
              join public.parties pa on pa.id = ap.party_id
             where ap.application_id = p.application_id and ap.role in ('owner', 'co_owner'))),
         p.created_at, p.house_no, p.govt_receipt_no,
         (select i.number from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'
          order by (i.status in ('issued', 'partially_paid')) desc, i.created_at desc limit 1),
         (select coalesce(sum(i.balance), 0) from public.invoices i join public.parcels o on o.id = i.parcel_id
           where (o.id = p.id or (o.parent_id = p.id and o.deleted_at is null)) and i.status in ('issued', 'partially_paid')),
         p.locked_at, p.lock_reason, a.number, d.name_en, n.name_en, p.plot_no, p.building_state, p.parent_id
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  left join public.applications a on a.id = p.application_id
  where p.deleted_at is null and p.status <> 'archived' and p.layout = 'house'
    and (coalesce(trim(p_q), '') = ''
         or (coalesce(trim(p_q), '') <> '' and (
            p.pun ilike '%' || trim(p_q) || '%'
         or p.account_no ilike trim(p_q) || '%'
         or p.house_no ilike trim(p_q) || '%'
         or p.govt_receipt_no ilike trim(p_q) || '%'
         or a.number ilike trim(p_q) || '%'
         or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
         or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                    where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%')
         or exists (select 1 from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                    where ap.application_id = p.application_id and pa.full_name ilike '%' || trim(p_q) || '%'))))
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.parcel_register(p_parcel uuid, p_land_use public.land_use default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  l public.parcels;
  v_out jsonb;
  r record;
begin
  select * into v from public.parcels where id = p_parcel and deleted_at is null;
  -- One flat or house: its owner, PUN and bills are its own. The land above counts as registered from the first one.
  if v.parent_id is not null then
    perform private.assert_permission('parcels.approve');
    select * into l from public.parcels where id = v.parent_id for update;
    if l.locked_at is not null then
      perform private.raise_app_error('CONFLICT', 'locked');
    end if;
    if l.site_check_status = 'not_found' then
      perform private.raise_app_error('CONFLICT', 'site_not_found');
    end if;
    v_out := private.parcel_register_one(p_parcel, p_land_use, p_note);
    if l.status in ('draft', 'surveyed', 'verified') then
      update public.parcels set status = 'registered', registered_at = now(), registered_by = auth.uid() where id = l.id;
      perform private.parcel_event(l.id, 'registered', 'Registered with ' || v.pun, jsonb_build_object('pun', l.pun, 'account_no', l.account_no));
    end if;
    return v_out;
  end if;
  if v.id is null or v.layout = 'house' then
    return private.parcel_register_one(p_parcel, p_land_use, p_note);
  end if;
  perform private.assert_permission('parcels.approve');
  if not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.status not in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('CONFLICT', 'locked');
  end if;
  if v.site_check_status = 'not_found' then
    perform private.raise_app_error('CONFLICT', 'site_not_found');
  end if;
  update public.parcels set status = 'registered', registered_at = now(), registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
   where id = v.id;
  perform private.parcel_event(v.id, 'registered', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Registered'),
    jsonb_build_object('pun', v.pun, 'account_no', v.account_no, 'provisional_boundary', v.geom_provisional));
  for r in select id, pun from public.parcels where parent_id = v.id and deleted_at is null and status in ('draft', 'surveyed', 'verified') loop
    update public.parcels set status = 'registered', registered_at = now(), registered_by = auth.uid(), land_use = coalesce(p_land_use, land_use)
     where id = r.id;
    perform private.parcel_event(r.id, 'registered', 'Registered with ' || v.pun, jsonb_build_object('pun', r.pun));
    insert into public.jobs (kind, payload, created_by)
    values ('sms.parcel_registered', jsonb_build_object('parcel_id', r.id, 'pun', r.pun), auth.uid());
  end loop;
  return jsonb_build_object('pun', v.pun, 'account_no', v.account_no, 'parcel_id', v.id);
end;
$$;

-- Land waiting counts each flat; registered still counts a building once, against the neighbourhood's capacity of houses.
create or replace function public.neighbourhood_registration_status(p_district uuid default null)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               has_boundary boolean, partial bigint, open_applications bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('parcels.yet_to_register') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.yet_to_register');
  end if;
  return query
    select n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, coalesce(n.has_geom, false),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.layout = 'house' and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.applications a
             where a.neighbourhood_id = n.id and a.status not in ('approved', 'rejected', 'cancelled')),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.neighbourhoods n
      join public.districts d on d.id = n.district_id
     where n.deleted_at is null and d.deleted_at is null
       and public.can_access_district(d.id) and (p_district is null or d.id = p_district)
     order by d.name_en, n.code;
end;
$$;

create or replace function public.neighbourhood_remaining(p_limit int default 50)
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
               count(*) filter (where p.parent_id is null and p.status in ('registered', 'disputed')) as registered,
               count(*) filter (where p.layout = 'house' and p.status in ('draft', 'surveyed', 'verified')) as waiting
          from public.parcels p
         where p.deleted_at is null
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
