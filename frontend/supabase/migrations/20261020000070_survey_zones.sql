-- Survey zones: an officer picks a neighbourhood (district → section → sector → neighbourhood), sees its
-- capacity (how many houses it holds) and assigns it to a surveyor with a target number of houses.
-- The surveyor sees the zone under Surveys → Zones, goes there and adds each house as field land; the
-- zone counts the land recorded in that neighbourhood since it was assigned, up to the target.

create table public.survey_zones (
  id              uuid primary key default gen_random_uuid(),
  neighbourhood_id uuid not null references public.neighbourhoods (id),
  district_id     uuid not null references public.districts (id),
  surveyor_id     uuid not null references auth.users (id),
  target          int not null check (target > 0 and target <= 100000),
  note            text,
  status          text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_by     uuid references auth.users (id) on delete set null,
  assigned_at     timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid references auth.users (id) on delete set null
);
-- One open zone per neighbourhood.
create unique index survey_zones_open_uidx on public.survey_zones (neighbourhood_id) where status = 'open';
create index survey_zones_surveyor_idx on public.survey_zones (surveyor_id) where status = 'open';
create index survey_zones_district_idx on public.survey_zones (district_id);
create trigger audit after insert or update or delete on public.survey_zones for each row execute function private.audit_row();

alter table public.survey_zones enable row level security;
revoke all on public.survey_zones from anon;
revoke insert, update, delete on public.survey_zones from authenticated;
create policy survey_zones_select on public.survey_zones for select to authenticated
  using (surveyor_id = auth.uid() or (public.has_permission('surveys.view') and public.can_access_district(district_id)));

/** Active surveyors who work in a district, with how many open zones and survey tasks they already have. */
create or replace function public.district_surveyors(p_district uuid)
returns table (user_id uuid, full_name text, open_zones bigint, open_tasks bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('surveys.approve');
  if p_district is null or not public.can_access_district(p_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  return query
    select p.user_id, p.full_name,
           (select count(*) from public.survey_zones z where z.surveyor_id = p.user_id and z.status = 'open'),
           (select count(*) from public.surveys s where s.surveyor_id = p.user_id
             and s.status in ('assigned', 'in_progress', 'returned', 'overlap_review'))
      from public.profiles p
     where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
       and not private.user_grants_all(p.user_id)
       and private.user_has_permission(p.user_id, 'surveys.create')
       and private.user_can_access_district(p.user_id, p_district)
     order by 3, 4, p.full_name
     limit 100;
end;
$$;

/** Assign a neighbourhood to a surveyor with a target number of houses (defaults to its capacity). */
create or replace function public.survey_zone_assign(p_neighbourhood uuid, p_surveyor uuid, p_target int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.neighbourhoods;
  v_target int;
  v_id uuid;
begin
  perform private.assert_permission('surveys.approve');
  select * into v_n from public.neighbourhoods where id = p_neighbourhood and deleted_at is null;
  if v_n.id is null or not public.can_access_district(v_n.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'neighbourhood');
  end if;
  v_target := coalesce(p_target, v_n.capacity);
  if v_target is null or v_target <= 0 or v_target > 100000 then
    perform private.raise_app_error('VALIDATION', 'target');
  end if;
  if p_surveyor is null or not exists (
       select 1 from public.profiles p
        where p.user_id = p_surveyor and p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
          and private.user_has_permission(p.user_id, 'surveys.create')
          and private.user_can_access_district(p.user_id, v_n.district_id)) then
    perform private.raise_app_error('VALIDATION', 'surveyor');
  end if;
  if exists (select 1 from public.survey_zones where neighbourhood_id = v_n.id and status = 'open') then
    perform private.raise_app_error('CONFLICT', 'zone_open');
  end if;
  insert into public.survey_zones (neighbourhood_id, district_id, surveyor_id, target, note, assigned_by)
  values (v_n.id, v_n.district_id, p_surveyor, v_target, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  -- The surveyor gets an in-app notice.
  insert into public.notifications (user_id, kind, title_so, title_en, body_so, body_en, link)
  values (p_surveyor, 'survey_zone.assigned', 'Aag lagu xilsaaray', 'Zone assigned to you',
          v_n.name_so || ' · ' || v_target || ' guri', v_n.name_en || ' · ' || v_target || ' houses', '/surveys?status=zones');
  return v_id;
end;
$$;

/** Close a zone: the surveyor or an officer marks it done; an officer can cancel it. */
create or replace function public.survey_zone_close(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.survey_zones;
begin
  select * into v from public.survey_zones where id = p_id for update;
  if v.id is null or not (v.surveyor_id = auth.uid() or (public.has_permission('surveys.approve') and public.can_access_district(v.district_id))) then
    perform private.raise_app_error('NOT_FOUND', 'zone');
  end if;
  if p_status not in ('done', 'cancelled') then
    perform private.raise_app_error('VALIDATION', 'status');
  end if;
  if p_status = 'cancelled' and not public.has_permission('surveys.approve') then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.approve');
  end if;
  if v.status <> 'open' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  update public.survey_zones set status = p_status, closed_at = now(), closed_by = auth.uid() where id = p_id;
end;
$$;

/** Zones with their progress: land recorded in the neighbourhood since assignment, partial and registered. */
create or replace function public.survey_zone_list(p_mine boolean default false, p_status text default 'open')
returns table (id uuid, neighbourhood_id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               surveyor_id uuid, surveyor text, target int, note text, status text, assigned_at timestamptz, assigned_by text,
               recorded bigint, partial bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('surveys.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'surveys.view');
  end if;
  return query
    select z.id, n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, z.surveyor_id, sp.full_name, z.target, z.note, z.status,
           z.assigned_at, ap.full_name,
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.created_at >= z.assigned_at),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.survey_zones z
      join public.neighbourhoods n on n.id = z.neighbourhood_id
      join public.districts d on d.id = z.district_id
      left join public.profiles sp on sp.user_id = z.surveyor_id
      left join public.profiles ap on ap.user_id = z.assigned_by
     where (z.surveyor_id = auth.uid() or (not coalesce(p_mine, false) and public.can_access_district(z.district_id)))
       and (coalesce(p_status, 'any') = 'any' or z.status = p_status)
     order by z.status = 'open' desc, z.assigned_at desc
     limit 500;
end;
$$;

grant execute on function public.district_surveyors(uuid), public.survey_zone_assign(uuid, uuid, int, text),
  public.survey_zone_close(uuid, text), public.survey_zone_list(boolean, text) to authenticated;
revoke execute on function public.district_surveyors(uuid), public.survey_zone_assign(uuid, uuid, int, text),
  public.survey_zone_close(uuid, text), public.survey_zone_list(boolean, text) from public, anon;
