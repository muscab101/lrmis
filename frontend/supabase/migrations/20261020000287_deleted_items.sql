-- Deleted items (owner's request, 2026-11-25): one page that holds everything deleted - land, owners, staff users and
-- places (districts, sections, sectors, neighbourhoods, streets, facilities) - so it can be brought back, and a nightly
-- job that removes it for good 3 months after it was deleted. Land with any money on it (a payment, or a bill with
-- anything paid or credited) is never removed for good (owner's choice). Anything still linked to records that stay
-- (for example an owner in the history of land that still exists) is kept until those links are gone.
-- Who: the new power deleted.view (Admin → Roles); super admins have every power.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('deleted.view', 'deleted', 'view', true, 'See deleted items and bring them back',
        'Arag waxyaabaha la tirtiray oo soo celi', 409)
on conflict (key) do nothing;

/** Land with money on it: a payment, or a bill with anything paid or credited. Never removed for good. */
create or replace function private.parcel_has_money(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payments pm where pm.parcel_id = p_id)
      or exists (select 1 from public.invoices i where i.parcel_id = p_id and (i.paid > 0 or i.credited > 0));
$$;

revoke all on function private.parcel_has_money(uuid) from public, anon, authenticated;

/** Everything deleted, newest first: what it is, its name, who deleted it and when, why, and when it goes for good. */
create or replace function public.deleted_items(p_kind text default null)
returns table (kind text, id uuid, label text, detail text, deleted_at timestamptz, deleted_by text, reason text,
               purge_on date, kept boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('deleted.view');
  return query
  select * from (
    select 'land'::text, p.id, coalesce(p.pun, 'House ' || coalesce(p.house_no, '—')),
           concat_ws(' · ', d.name_en, n.code, nullif(p.house_no, '')),
           p.deleted_at, private.staff_name_of(p.deleted_by), p.delete_reason,
           (p.deleted_at + interval '90 days')::date, private.parcel_has_money(p.id)
      from public.parcels p
      left join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
     where p.deleted_at is not null and public.can_access_district(p.district_id)
    union all
    select 'owner', pa.id, pa.full_name, concat_ws(' · ', pa.phone, pa.id_number),
           pa.deleted_at, private.staff_name_of(pa.deleted_by), pa.delete_reason,
           (pa.deleted_at + interval '90 days')::date, false
      from public.parties pa
     where pa.deleted_at is not null and (pa.district_id is null or public.can_access_district(pa.district_id))
    union all
    select 'user', pr.user_id, coalesce(nullif(pr.full_name, ''), pr.email), pr.email,
           pr.deleted_at, null, null, (pr.deleted_at + interval '90 days')::date, false
      from public.profiles pr
     where pr.deleted_at is not null and pr.kind = 'staff'
    union all
    select 'district', x.id, x.code || ' · ' || x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.districts x where x.deleted_at is not null
    union all
    select 'section', x.id, x.code || ' · ' || x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.sections x where x.deleted_at is not null
    union all
    select 'sector', x.id, x.code || ' · ' || x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.sectors x where x.deleted_at is not null
    union all
    select 'neighbourhood', x.id, x.code || ' · ' || x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.neighbourhoods x where x.deleted_at is not null
    union all
    select 'street', x.id, x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.streets x where x.deleted_at is not null
    union all
    select 'facility', x.id, x.name_en, null, x.deleted_at, null, null, (x.deleted_at + interval '90 days')::date, false
      from public.facilities x where x.deleted_at is not null
  ) t (kind, id, label, detail, deleted_at, deleted_by, reason, purge_on, kept)
  where p_kind is null or t.kind = p_kind
  order by t.deleted_at desc
  limit 1000;
end;
$$;

revoke all on function public.deleted_items(text) from public, anon;
grant execute on function public.deleted_items(text) to authenticated;

/** Bring a deleted item back. Land gets back the bills its deletion cancelled; a place needs its parent back first. */
create or replace function public.deleted_restore(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  perform private.assert_permission('deleted.view');
  case p_kind
    when 'land' then
      if not exists (select 1 from public.parcels where id = p_id and deleted_at is not null and public.can_access_district(district_id)) then
        perform private.raise_app_error('NOT_FOUND', 'land');
      end if;
      update public.parcels set deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
      -- The bills its deletion cancelled come back.
      for r in select i.id from public.invoices i where i.parcel_id = p_id and i.status = 'cancelled' and i.cancel_reason like 'Land deleted:%' loop
        update public.invoices set status = 'issued', cancel_reason = null where id = r.id;
        perform private.invoice_refresh_status(r.id);
      end loop;
      perform private.parcel_event(p_id, 'restored', null, '{}'::jsonb);
      return;
    when 'owner' then
      update public.parties set deleted_at = null, deleted_by = null, delete_reason = null
       where id = p_id and deleted_at is not null and (district_id is null or public.can_access_district(district_id));
    when 'user' then
      update public.profiles set deleted_at = null, status = 'active' where user_id = p_id and deleted_at is not null and kind = 'staff';
    when 'district' then
      update public.districts set deleted_at = null where id = p_id and deleted_at is not null;
    when 'section' then
      if exists (select 1 from public.sections s join public.districts d on d.id = s.district_id where s.id = p_id and d.deleted_at is not null) then
        perform private.raise_app_error('CONFLICT', 'parent_deleted');
      end if;
      update public.sections set deleted_at = null where id = p_id and deleted_at is not null;
    when 'sector' then
      if exists (select 1 from public.sectors s join public.sections p on p.id = s.section_id where s.id = p_id and p.deleted_at is not null) then
        perform private.raise_app_error('CONFLICT', 'parent_deleted');
      end if;
      update public.sectors set deleted_at = null where id = p_id and deleted_at is not null;
    when 'neighbourhood' then
      if exists (select 1 from public.neighbourhoods n join public.sectors s on s.id = n.sector_id where n.id = p_id and s.deleted_at is not null) then
        perform private.raise_app_error('CONFLICT', 'parent_deleted');
      end if;
      update public.neighbourhoods set deleted_at = null where id = p_id and deleted_at is not null;
    when 'street' then
      update public.streets set deleted_at = null where id = p_id and deleted_at is not null;
    when 'facility' then
      update public.facilities set deleted_at = null where id = p_id and deleted_at is not null;
    else
      perform private.raise_app_error('VALIDATION', 'kind');
  end case;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform private.raise_app_error('NOT_FOUND', p_kind);
  end if;
end;
$$;

revoke all on function public.deleted_restore(text, uuid) from public, anon;
grant execute on function public.deleted_restore(text, uuid) to authenticated;

/** Remove for good what was deleted more than 3 months ago. Land with money stays; anything still linked stays. */
create or replace function private.purge_deleted()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_cut timestamptz := now() - interval '90 days';
  v_done jsonb := '{}'::jsonb;
  v_kept int := 0;
begin
  -- Land (flats and compound houses first, then their buildings), never land with money.
  for r in select p.id from public.parcels p
            where p.deleted_at < v_cut and not private.parcel_has_money(p.id)
            order by (p.parent_id is null), p.deleted_at loop
    begin
      delete from public.invoice_lines l using public.invoices i where l.invoice_id = i.id and i.parcel_id = r.id;
      delete from public.invoices where parcel_id = r.id;
      delete from public.parcel_owners where parcel_id = r.id;
      delete from public.parcel_history where parcel_id = r.id;
      delete from public.issued_documents where parcel_id = r.id;
      delete from public.buildings where parcel_id = r.id;
      delete from public.building_extra_areas where parcel_id = r.id;
      delete from public.assessments where parcel_id = r.id;
      delete from public.exemptions where parcel_id = r.id;
      delete from public.parcels where id = r.id;
      v_done := jsonb_set(v_done, '{land}', to_jsonb(coalesce((v_done ->> 'land')::int, 0) + 1));
    exception when others then
      v_kept := v_kept + 1;
    end;
  end loop;

  for r in select pa.id from public.parties pa where pa.deleted_at < v_cut loop
    begin
      delete from public.parties where id = r.id;
      v_done := jsonb_set(v_done, '{owners}', to_jsonb(coalesce((v_done ->> 'owners')::int, 0) + 1));
    exception when others then
      v_kept := v_kept + 1;
    end;
  end loop;

  for r in select pr.user_id from public.profiles pr where pr.deleted_at < v_cut and pr.kind = 'staff' loop
    begin
      delete from auth.users where id = r.user_id;
      v_done := jsonb_set(v_done, '{users}', to_jsonb(coalesce((v_done ->> 'users')::int, 0) + 1));
    exception when others then
      v_kept := v_kept + 1;
    end;
  end loop;

  -- Places, smallest first, so a sector can go before its section.
  for r in
    select 'facilities' t, id from public.facilities where deleted_at < v_cut
    union all select 'streets', id from public.streets where deleted_at < v_cut
    union all select 'neighbourhoods', id from public.neighbourhoods where deleted_at < v_cut
    union all select 'sectors', id from public.sectors where deleted_at < v_cut
    union all select 'sections', id from public.sections where deleted_at < v_cut
    union all select 'districts', id from public.districts where deleted_at < v_cut
  loop
    begin
      execute format('delete from public.%I where id = $1', r.t) using r.id;
      v_done := jsonb_set(v_done, '{places}', to_jsonb(coalesce((v_done ->> 'places')::int, 0) + 1));
    exception when others then
      v_kept := v_kept + 1;
    end;
  end loop;

  return v_done || jsonb_build_object('kept', v_kept);
end;
$$;

revoke all on function private.purge_deleted() from public, anon, authenticated;

-- Every night at 03:40.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-deleted';
    perform cron.schedule('purge-deleted', '40 3 * * *', 'select private.purge_deleted()');
  end if;
end;
$$;
