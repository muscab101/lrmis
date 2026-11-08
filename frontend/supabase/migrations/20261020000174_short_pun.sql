-- Short PUN: district, section, sector, neighbourhood and the house's number, each without leading zeros, run together.
--   34KRWJXL0712 (Kaaraan 34, section 04, sector 01, neighbourhood 07, house 12)  →  3441712
-- A flat or compound house keeps a dash before its own number (3441718-1); a land split in two keeps its letter (3441113A).
-- Run together, two places can read alike, so a number already in use is never handed out again (the next one is).
-- Every land is renumbered now (owner decision 2026-11-07). The old PUN is kept in pun_old: searching for it still
-- finds the land, and certificates show the new PUN when printed again.

alter table public.parcels add column if not exists pun_old text;
create index if not exists parcels_pun_old_idx on public.parcels (pun_old) where pun_old is not null;

/** A code's number without leading zeros ("04" → "4", "KRWJXL07" → "7"); a code with no digits stays as it is ("HDN"). */
create or replace function private.pun_number(p_code text, p_trailing boolean default false)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_code, '') !~ '\d' then upper(coalesce(p_code, ''))
    else coalesce(nullif(ltrim(case when p_trailing then substring(p_code from '(\d+)$')
                                    else regexp_replace(p_code, '\D', '', 'g') end, '0'), ''), '0')
  end;
$$;

/** The place part of a PUN: district, section, sector and neighbourhood numbers run together. */
create or replace function private.pun_place(p_district uuid, p_neighbourhood uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.pun_number(d.code)
         || case when s.id is null then '' else private.pun_number(s.code) end
         || case when se.id is null then '' else private.pun_number(se.code) end
         || case when n.id is null then '' else private.pun_number(n.code, true) end
    from public.districts d
    left join public.neighbourhoods n on n.id = p_neighbourhood
    left join public.sectors se on se.id = n.sector_id
    left join public.sections s on s.id = se.section_id
   where d.id = p_district;
$$;
revoke all on function private.pun_place(uuid, uuid) from public;

-- New PUNs: {place} then the house's number with no zeros in front.
insert into public.settings (key, value, description)
values ('registration.pun_format', to_jsonb('{place}{serial}'::text), 'PUN shape: {place} = district, section, sector, neighbourhood numbers; {serial} = house number')
on conflict (key) do update set value = excluded.value;

create or replace function private.next_pun(p_district uuid, p_neighbourhood uuid)
returns table (pun text, account_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial int;
  v_account int;
  v_dcode text;
  v_ncode text;
  v_pun text;
  v_format text;
begin
  insert into public.pun_counters (district_id) values (p_district) on conflict do nothing;
  select code into v_dcode from public.districts where id = p_district;
  select code into v_ncode from public.neighbourhoods where id = p_neighbourhood;
  v_format := replace(coalesce((select value #>> '{}' from public.settings where key = 'registration.pun_format'), '{place}{serial}'),
                      '{place}', coalesce(private.pun_place(p_district, p_neighbourhood), ''));
  -- Row lock: concurrent registrations in a district queue here, so numbers have no gaps or duplicates.
  update public.pun_counters set last_account = last_account + 1 where district_id = p_district returning last_account into v_account;
  loop
    update public.pun_counters set last_serial = last_serial + 1 where district_id = p_district returning last_serial into v_serial;
    v_pun := private.format_serial(v_format, v_dcode, v_ncode, v_serial);
    -- Never a number that is (or was) some other land's.
    exit when not exists (select 1 from public.parcels p where p.pun = v_pun or p.pun_old = v_pun);
  end loop;
  return query select v_pun,
    private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'),
                                   '{district}{serial:7}'), v_dcode, v_ncode, v_account);
end;
$$;

-- Renumber every land that has a PUN. The locks on demolished, locked and unit land guard their details, not the
-- PUN's shape: they stand aside for this one renumber only.
alter table public.parcels disable trigger archive_guard;
alter table public.parcels disable trigger lock_guard;
alter table public.parcels disable trigger land_units_guard;
do $do$
declare
  r record;
  v_rest text;
  v_serial text;
  v_tail text;
  v_new text;
  v_n int;
begin
  create temp table pun_map (id uuid primary key, old text, new text) on commit drop;

  -- Whole lands first (not flats or compound houses).
  for r in
    select p.id, p.pun, p.district_id, p.neighbourhood_id, d.code as dcode, n.code as ncode
      from public.parcels p join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
     where p.pun is not null and p.parent_id is null
     order by p.created_at
  loop
    v_new := null;
    -- 34KRWJXL0113A → house "13", letter "A".
    if r.pun like r.dcode || coalesce(r.ncode, '') || '%' then
      v_rest := substr(r.pun, length(r.dcode || coalesce(r.ncode, '')) + 1);
      v_serial := substring(v_rest from '^(\d+)');
      v_tail := substr(v_rest, length(coalesce(v_serial, '')) + 1);
      if v_serial is not null then
        v_new := private.pun_place(r.district_id, r.neighbourhood_id) || coalesce(nullif(ltrim(v_serial, '0'), ''), '0') || v_tail;
      end if;
    end if;
    -- An older shape, or a number someone already has: a fresh one.
    if v_new is null or exists (select 1 from pun_map m where m.new = v_new) then
      loop
        insert into public.pun_counters (district_id) values (r.district_id) on conflict do nothing;
        update public.pun_counters set last_serial = last_serial + 1 where district_id = r.district_id returning last_serial into v_n;
        v_new := private.pun_place(r.district_id, r.neighbourhood_id) || v_n;
        exit when not exists (select 1 from pun_map m where m.new = v_new);
      end loop;
    end if;
    insert into pun_map values (r.id, r.pun, v_new);
  end loop;

  -- Flats and compound houses: their land's new PUN, a dash, their own number without zeros in front.
  for r in
    select c.id, c.pun, par.pun as parent_old, m.new as parent_new
      from public.parcels c join public.parcels par on par.id = c.parent_id
      join pun_map m on m.id = par.id
     where c.pun is not null
  loop
    v_tail := case when r.pun like r.parent_old || '-%' then substr(r.pun, length(r.parent_old) + 2) else split_part(r.pun, '-', 2) end;
    v_new := r.parent_new || '-' || coalesce(nullif(ltrim(v_tail, '0'), ''), '0');
    insert into pun_map values (r.id, r.pun, v_new);
  end loop;

  update public.parcels p set pun_old = m.old, pun = m.new from pun_map m where m.id = p.id and p.pun is distinct from m.new;

  -- Certificates and ID cards carry the land's PUN: the new one shows when they are printed again.
  update public.issued_documents d
     set snapshot = jsonb_set(d.snapshot, '{pun}', to_jsonb(m.new))
    from pun_map m
   where m.id = d.parcel_id and d.snapshot ->> 'pun' is distinct from m.new;
end;
$do$;
alter table public.parcels enable trigger archive_guard;
alter table public.parcels enable trigger lock_guard;
alter table public.parcels enable trigger land_units_guard;

-- Searching for an old PUN still finds the land.
do $do$
declare
  d text := pg_get_functiondef('public.search_parcels(text,integer)'::regprocedure);
  a text := $a$p.pun ilike '%' || trim(p_q) || '%'$a$;
  b text := $b$(p.pun ilike '%' || trim(p_q) || '%' or coalesce(p.pun_old, '') ilike '%' || trim(p_q) || '%')$b$;
begin
  if position(a in d) = 0 then
    raise exception 'search_parcels: PUN match not found';
  end if;
  execute replace(d, a, b);
end;
$do$;
