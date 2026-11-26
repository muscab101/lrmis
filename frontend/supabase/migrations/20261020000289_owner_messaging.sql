-- Messages to owners (owner's request, 2026-11-26): write one message and send it to chosen owners, or to every owner
-- with land in chosen districts, sections, sectors or neighbourhoods. It is personalised with placeholders
-- ({owner_name}, {property_number}, {district_name}, {neighbourhood_name}, {tax_amount}, {outstanding_balance},
-- {payment_deadline}). Before sending, a check shows how many owners there are, how many have a good phone, and which
-- are missing, wrong or the same phone twice. Nothing goes out until the sender confirms. It can go now or at a set
-- time. Each send is a campaign in the history, with delivered/failed counts, retry and export.
--
-- Who can send to whom: a user sends only to owners with land in their own districts (as everywhere else). A user
-- can also be limited to some sections, sectors or neighbourhoods (Admin → Users → Messaging area), and then only
-- reaches owners with land there. Every send, retry and cancel is written to the audit log. Uses the existing powers
-- messages.create (send), messages.update (retry), messages.cancel (stop what has not gone yet).

-- 1. Where a user may send messages (no rows = their whole districts).
create table if not exists public.user_areas (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  level text not null check (level in ('section', 'sector', 'neighbourhood')),
  area_id uuid not null,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, level, area_id)
);
alter table public.user_areas enable row level security;
drop policy if exists user_areas_select on public.user_areas;
create policy user_areas_select on public.user_areas for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.view'));
revoke insert, update, delete on public.user_areas from anon, authenticated;

-- 2. Campaigns written by hand.
alter table public.message_campaigns alter column template_code drop not null;
alter table public.message_campaigns
  add column if not exists kind text not null default 'template',
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists lang text,
  add column if not exists body text,
  add column if not exists target jsonb,
  add column if not exists areas jsonb,
  add column if not exists district_ids uuid[],
  add column if not exists scheduled_at timestamptz,
  add column if not exists allow_duplicates boolean not null default false;
alter table public.message_campaigns drop constraint if exists message_campaigns_kind_check;
alter table public.message_campaigns add constraint message_campaigns_kind_check check (kind in ('template', 'compose'));
alter table public.message_campaigns drop constraint if exists message_campaigns_category_check;
alter table public.message_campaigns add constraint message_campaigns_category_check
  check (category is null or category in ('tax_reminder', 'tax_invoice', 'payment_confirmation', 'outstanding_tax', 'general', 'government', 'custom'));
create index if not exists messages_campaign_status_idx on public.messages (campaign_id, status) where campaign_id is not null;

-- Templates to start a message from, by category.
alter table public.message_templates add column if not exists category text;
insert into public.message_templates (code, channel, body_so, body_en, description, is_system, active, category) values
  ('msg_tax_reminder', 'sms',
   'Mudane {owner_name}, canshuurta dhulka {tax_amount} ee dhulka {property_number} waa la gaaray. Fadlan bixi ka hor {payment_deadline}. Mahadsanid.',
   'Dear {owner_name}, your property tax payment of {tax_amount} is due. Property Number: {property_number}. Please complete your payment before {payment_deadline}. Thank you.',
   'Tax payment reminder', false, true, 'tax_reminder'),
  ('msg_tax_invoice', 'sms',
   'Mudane {owner_name}, biilka canshuurta dhulka {property_number} ee sannadkan waa {tax_amount}. Waqtiga bixinta: {payment_deadline}.',
   'Dear {owner_name}, this year''s property tax bill for {property_number} is {tax_amount}. Pay by {payment_deadline}.',
   'Tax invoice notification', false, true, 'tax_invoice'),
  ('msg_outstanding', 'sms',
   'Mudane {owner_name}, waxaa lagugu leeyahay {outstanding_balance} oo canshuur ah (dhulka {property_number}). Fadlan bixi sida ugu dhaqsaha badan.',
   'Dear {owner_name}, you have {outstanding_balance} of unpaid tax (property {property_number}). Please pay as soon as possible.',
   'Outstanding tax notification', false, true, 'outstanding_tax'),
  ('msg_announcement', 'sms',
   'Ogeysiis: dadka dhulka ku leh {neighbourhood_name}, {district_name}: ',
   'Notice to property owners in {neighbourhood_name}, {district_name}: ',
   'General announcement', false, true, 'general')
on conflict (code) do nothing;

-- 3. Helpers.

/** A phone ready to text (+252 and 9 digits, or another country's +number), or null when it is wrong. */
create or replace function private.sms_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~ '^\+252[0-9]{9}$' then v
    when v ~ '^\+252' then null
    when v ~ '^\+[1-9][0-9]{7,14}$' then v
    when v ~ '^00252[0-9]{9}$' then '+' || substr(v, 3)
    when v ~ '^252[0-9]{9}$' then '+' || v
    when v ~ '^0?[1-9][0-9]{8}$' then '+252' || right(v, 9)
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as v) x;
$$;

/** Is the signed-in user limited to some sections, sectors or neighbourhoods? */
create or replace function private.my_areas_limited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_areas where user_id = auth.uid());
$$;

/** May the signed-in user send to this whole district, section, sector or neighbourhood? */
create or replace function private.area_allowed(p_level text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d uuid;
  v_sec uuid;
  v_sct uuid;
begin
  if p_level = 'district' then
    select id into v_d from public.districts where id = p_id and deleted_at is null;
  elsif p_level = 'section' then
    select district_id, id into v_d, v_sec from public.sections where id = p_id and deleted_at is null;
  elsif p_level = 'sector' then
    select coalesce(s.district_id, se.district_id), s.section_id, s.id into v_d, v_sec, v_sct
      from public.sectors s left join public.sections se on se.id = s.section_id where s.id = p_id and s.deleted_at is null;
  elsif p_level = 'neighbourhood' then
    select coalesce(n.district_id, s.district_id), s.section_id, n.sector_id into v_d, v_sec, v_sct
      from public.neighbourhoods n left join public.sectors s on s.id = n.sector_id where n.id = p_id and n.deleted_at is null;
  else
    return false;
  end if;
  if v_d is null or not public.can_access_district(v_d) then
    return false;
  end if;
  if not private.my_areas_limited() then
    return true;
  end if;
  return exists (select 1 from public.user_areas a where a.user_id = auth.uid() and (
           (a.level = 'section' and a.area_id = v_sec)
        or (a.level = 'sector' and a.area_id = v_sct)
        or (a.level = 'neighbourhood' and p_level = 'neighbourhood' and a.area_id = p_id)));
end;
$$;

/** Every land the signed-in user may message about, with its current owners. */
create or replace function private.my_owner_land()
returns table (parcel_id uuid, party_id uuid, label text, district_id uuid, neighbourhood_id uuid, sector_id uuid, section_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select pc.id, po.party_id, coalesce(pc.pun, nullif('House ' || pc.house_no, 'House ')), pc.district_id, pc.neighbourhood_id,
         nb.sector_id, sc.section_id
    from public.parcels pc
    join public.parcel_owners po on po.parcel_id = pc.id and po.valid_to is null
    left join public.neighbourhoods nb on nb.id = pc.neighbourhood_id
    left join public.sectors sc on sc.id = nb.sector_id
   where pc.deleted_at is null and pc.status <> 'archived'
     and public.can_access_district(pc.district_id)
     and (not private.my_areas_limited()
          or exists (select 1 from public.user_areas a where a.user_id = auth.uid() and (
                  (a.level = 'section' and a.area_id = sc.section_id)
               or (a.level = 'sector' and a.area_id = nb.sector_id)
               or (a.level = 'neighbourhood' and a.area_id = pc.neighbourhood_id))));
$$;

/** The ids in one list of a target ({"owners": [...], "districts": [...], ...}). */
create or replace function private.target_ids(p_target jsonb, p_key text)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select x::uuid from jsonb_array_elements_text(
           case when jsonb_typeof(p_target -> p_key) = 'array' then p_target -> p_key else '[]'::jsonb end) x), '{}');
$$;

/** Refuses a target the user may not send to: an area outside their own, or nothing chosen. */
create or replace function private.compose_check_target(p_target jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level text;
  v_id uuid;
  v_n int := 0;
begin
  foreach v_level in array array['district', 'section', 'sector', 'neighbourhood'] loop
    foreach v_id in array private.target_ids(p_target, v_level || 's') loop
      v_n := v_n + 1;
      if not private.area_allowed(v_level, v_id) then
        perform private.raise_app_error('PERMISSION_DENIED', 'area');
      end if;
    end loop;
  end loop;
  if v_n > 300 then
    perform private.raise_app_error('VALIDATION', 'too_many_areas');
  end if;
  if cardinality(private.target_ids(p_target, 'owners')) > 1000 then
    perform private.raise_app_error('VALIDATION', 'too_many_owners');
  end if;
  if v_n = 0 and cardinality(private.target_ids(p_target, 'owners')) = 0 then
    perform private.raise_app_error('VALIDATION', 'no_target');
  end if;
end;
$$;

/** The owners a target reaches, one row each, with their phone, whether it can be texted, and their placeholders. */
create or replace function private.compose_recipients(p_target jsonb, p_lang text, p_allow_dup boolean)
returns table (party_id uuid, full_name text, phone_raw text, phone text, state text, district_id uuid, vars jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with land as (
    select l.* from private.my_owner_land() l
     where l.party_id = any (private.target_ids(p_target, 'owners'))
        or l.district_id = any (private.target_ids(p_target, 'districts'))
        or l.section_id = any (private.target_ids(p_target, 'sections'))
        or l.sector_id = any (private.target_ids(p_target, 'sectors'))
        or l.neighbourhood_id = any (private.target_ids(p_target, 'neighbourhoods'))
  ),
  money as (
    select l.party_id,
           sum(i.total) filter (where ft.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
                                  and i.period = extract(year from current_date)::text) as tax,
           sum(i.balance) filter (where i.status in ('issued', 'partially_paid')) as owing,
           min(i.due_date) filter (where i.status in ('issued', 'partially_paid') and i.balance > 0) as due
      from (select distinct land.parcel_id, land.party_id from land) l
      join public.invoices i on i.parcel_id = l.parcel_id
      left join public.fee_types ft on ft.id = i.fee_type_id
     group by l.party_id
  ),
  owners as (
    select l.party_id,
           array_agg(distinct l.label) filter (where l.label is not null) as labels,
           (array_agg(l.district_id order by l.label))[1] as district_id,
           (array_agg(l.neighbourhood_id order by l.label) filter (where l.neighbourhood_id is not null))[1] as nb_id
      from land l group by l.party_id
  ),
  people as (
    select o.party_id, o.labels, o.district_id, p.full_name, p.phone as phone_raw, private.sms_phone(p.phone) as phone,
           case when p_lang = 'en' then d.name_en else d.name_so end as dname,
           case when p_lang = 'en' then nb.name_en else nb.name_so end as nbname,
           m.tax, m.owing, m.due
      from owners o
      join public.parties p on p.id = o.party_id and p.deleted_at is null
      left join public.districts d on d.id = o.district_id
      left join public.neighbourhoods nb on nb.id = o.nb_id
      left join money m on m.party_id = o.party_id
  ),
  ranked as (
    select people.*, row_number() over (partition by people.phone order by people.full_name, people.party_id) as rn from people
  )
  select r.party_id, r.full_name, r.phone_raw, r.phone,
         case when nullif(trim(coalesce(r.phone_raw, '')), '') is null then 'missing'
              when r.phone is null then 'invalid'
              when r.rn > 1 and not p_allow_dup then 'duplicate'
              else 'ok' end,
         r.district_id,
         jsonb_build_object(
           'owner_name', r.full_name,
           'property_number', coalesce(array_to_string(r.labels[1:3], ', ')
                                       || case when cardinality(r.labels) > 3 then ' +' || (cardinality(r.labels) - 3) else '' end, ''),
           'district_name', coalesce(r.dname, ''),
           'neighbourhood_name', coalesce(r.nbname, ''),
           'tax_amount', to_char(coalesce(r.tax, 0), 'FM999999990.00') || ' USD',
           'outstanding_balance', to_char(coalesce(r.owing, 0), 'FM999999990.00') || ' USD',
           'payment_deadline', coalesce(to_char(r.due, 'DD/MM/YYYY'), ''))
    from ranked r;
$$;

/** A message with its placeholders filled. */
create or replace function private.compose_render(p_body text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v text;
begin
  for k, v in select * from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    p_body := replace(p_body, '{' || k || '}', coalesce(v, ''));
  end loop;
  return left(p_body, 1000);
end;
$$;

/** The names of the areas in a target, for the history: [{level, name}]. */
create or replace function private.compose_area_names(p_target jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select 'district' as level, d.name_so, d.name_en, d.code from public.districts d where d.id = any (private.target_ids(p_target, 'districts'))
    union all select 'section', s.name_so, s.name_en, s.code from public.sections s where s.id = any (private.target_ids(p_target, 'sections'))
    union all select 'sector', s.name_so, s.name_en, s.code from public.sectors s where s.id = any (private.target_ids(p_target, 'sectors'))
    union all select 'neighbourhood', n.name_so, n.name_en, n.code from public.neighbourhoods n where n.id = any (private.target_ids(p_target, 'neighbourhoods'))
  ) x;
$$;

/** May the signed-in user see this campaign? */
create or replace function private.campaign_visible(p_district uuid, p_districts uuid[], p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_districts is not null then
      p_created_by = auth.uid() or private.user_has_all_districts(auth.uid())
      or exists (select 1 from unnest(p_districts) d where public.can_access_district(d))
    when p_district is null then true
    else public.can_access_district(p_district)
  end;
$$;

drop policy if exists message_campaigns_select on public.message_campaigns;
create policy message_campaigns_select on public.message_campaigns for select to authenticated
  using (public.has_permission('messages.view') and private.campaign_visible(district_id, district_ids, created_by));

-- 4. What the app calls.

/** Districts, sections, sectors or neighbourhoods to choose from (under p_parent), with how many owners each has. */
create or replace function public.compose_areas(p_level text, p_parent uuid default null)
returns table (id uuid, code text, name_so text, name_en text, owners int, allowed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('messages.create') or public.has_permission('users.update')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'messages.create');
  end if;
  return query
  with mine as (
    -- The places above each area the user is limited to, so they can be opened to reach it.
    select coalesce(n.district_id, s.district_id, se.district_id) as district_id,
           coalesce(s.section_id, se.id) as section_id, coalesce(n.sector_id, case when a.level = 'sector' then a.area_id end) as sector_id
      from public.user_areas a
      left join public.neighbourhoods n on a.level = 'neighbourhood' and n.id = a.area_id
      left join public.sectors s on s.id = coalesce(n.sector_id, case when a.level = 'sector' then a.area_id end)
      left join public.sections se on se.id = coalesce(s.section_id, case when a.level = 'section' then a.area_id end)
     where a.user_id = auth.uid()
  ),
  counts as (
    select case p_level when 'district' then l.district_id when 'section' then l.section_id
                        when 'sector' then l.sector_id else l.neighbourhood_id end as area_id,
           count(distinct l.party_id)::int as n
      from private.my_owner_land() l group by 1
  ),
  places as (
    select d.id, d.code, d.name_so, d.name_en from public.districts d
     where p_level = 'district' and d.deleted_at is null
    union all select s.id, s.code, s.name_so, s.name_en from public.sections s
     where p_level = 'section' and s.deleted_at is null and s.district_id = p_parent
    union all select s.id, s.code, s.name_so, s.name_en from public.sectors s
     where p_level = 'sector' and s.deleted_at is null and s.section_id = p_parent
    union all select n.id, n.code, n.name_so, n.name_en from public.neighbourhoods n
     where p_level = 'neighbourhood' and n.deleted_at is null and n.sector_id = p_parent
  )
  select p.id, p.code, p.name_so, p.name_en, coalesce(c.n, 0), private.area_allowed(p_level, p.id)
    from places p
    left join counts c on c.area_id = p.id
   where private.area_allowed(p_level, p.id)
      or (private.my_areas_limited() and p.id in (select m.district_id from mine m union select m.section_id from mine m
                                                    union select m.sector_id from mine m))
   order by p.code, p.name_en
   limit 500;
end;
$$;

/** Owners the user may message, found by name, ID number, phone or land number. */
create or replace function public.compose_search_owners(p_q text)
returns table (id uuid, full_name text, phone text, id_number text, properties text, district text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := trim(coalesce(p_q, ''));
  v_digits text := private.norm_phone(p_q);
begin
  perform private.assert_permission('messages.create');
  if length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.full_name, p.phone, p.id_number,
         string_agg(distinct l.label, ', ') filter (where l.label is not null),
         max(d.name_en)
    from private.my_owner_land() l
    join public.parties p on p.id = l.party_id and p.deleted_at is null
    join public.parcels pc on pc.id = l.parcel_id
    left join public.districts d on d.id = l.district_id
   where p.full_name ilike '%' || v_q || '%'
      or p.id_number ilike v_q || '%'
      or (length(v_digits) >= 5 and private.norm_phone(p.phone) like '%' || v_digits || '%')
      or pc.pun ilike v_q || '%' or pc.account_no ilike v_q || '%' or pc.house_no = v_q
   group by p.id, p.full_name, p.phone, p.id_number
   order by p.full_name
   limit 25;
end;
$$;

/** The check before sending: counts, problems, the areas, and the message as the first owner gets it. */
create or replace function public.compose_preview(p_target jsonb, p_lang text, p_body text, p_allow_duplicates boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_first jsonb;
begin
  perform private.assert_permission('messages.create');
  perform private.compose_check_target(p_target);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.state = 'ok', r.full_name), '[]'::jsonb) into v
    from private.compose_recipients(p_target, coalesce(p_lang, 'so'), coalesce(p_allow_duplicates, false)) r;
  select e -> 'vars' into v_first from jsonb_array_elements(v) e where e ->> 'state' = 'ok' limit 1;
  if exists (select 1 from unnest(private.target_ids(p_target, 'owners')) o
              where not exists (select 1 from jsonb_array_elements(v) e where (e ->> 'party_id')::uuid = o)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owner');
  end if;
  return jsonb_build_object(
    'owners', jsonb_array_length(v),
    'valid', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'ok'),
    'missing', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'missing'),
    'invalid', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'invalid'),
    'duplicates', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'duplicate'),
    'areas', private.compose_area_names(p_target),
    'sample', case when v_first is not null and length(coalesce(p_body, '')) > 0 then private.compose_render(p_body, v_first) end,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('party_id', e -> 'party_id', 'name', e -> 'full_name',
                                       'phone', coalesce(e ->> 'phone', e ->> 'phone_raw'), 'state', e -> 'state')), '[]'::jsonb)
               from (select e from jsonb_array_elements(v) e limit 300) x));
end;
$$;

/**
 * Sends (or schedules) a message to the owners of a target. p_expect is the number of good phones the sender saw in
 * the check: if it has changed since, nothing is sent (CONFLICT recipients_changed) so the sender looks again.
 */
create or replace function public.compose_send(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target jsonb := coalesce(p -> 'target', '{}'::jsonb);
  v_lang text := coalesce(p ->> 'lang', 'so');
  v_body text := trim(coalesce(p ->> 'body', ''));
  v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
  v_category text := coalesce(p ->> 'category', 'custom');
  v_at timestamptz := nullif(p ->> 'scheduled_at', '')::timestamptz;
  v_dup boolean := coalesce((p ->> 'allow_duplicates')::boolean, false);
  v_id uuid;
  v_number text;
  v_n int := 0;
  v_ok int;
  v_districts uuid[];
  v_rows jsonb;
  r record;
begin
  perform private.assert_permission('messages.create');
  if v_lang not in ('so', 'en') then
    perform private.raise_app_error('VALIDATION', 'lang');
  end if;
  if length(v_body) < 2 then
    perform private.raise_app_error('VALIDATION', 'body');
  end if;
  if length(v_body) > 640 then
    perform private.raise_app_error('VALIDATION', 'body_long');
  end if;
  if length(coalesce(v_title, '')) > 120 then
    perform private.raise_app_error('VALIDATION', 'title');
  end if;
  if v_category not in ('tax_reminder', 'tax_invoice', 'payment_confirmation', 'outstanding_tax', 'general', 'government', 'custom') then
    perform private.raise_app_error('VALIDATION', 'category');
  end if;
  if v_at is not null and (v_at < now() - interval '5 minutes' or v_at > now() + interval '90 days') then
    perform private.raise_app_error('VALIDATION', 'scheduled_at');
  end if;
  if v_at is not null and v_at <= now() then
    v_at := null;
  end if;
  perform private.compose_check_target(v_target);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
    from private.compose_recipients(v_target, v_lang, v_dup) x;
  if exists (select 1 from unnest(private.target_ids(v_target, 'owners')) o
              where not exists (select 1 from jsonb_array_elements(v_rows) e where (e ->> 'party_id')::uuid = o)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owner');
  end if;
  select count(*) into v_ok from jsonb_array_elements(v_rows) e where e ->> 'state' = 'ok';
  if v_ok = 0 then
    perform private.raise_app_error('VALIDATION', 'no_recipients');
  end if;
  if (p ? 'expect') and v_ok <> (p ->> 'expect')::int then
    perform private.raise_app_error('CONFLICT', 'recipients_changed');
  end if;
  if v_ok > private.setting_int('messages.campaign_limit', 5000) then
    perform private.raise_app_error('VALIDATION', 'too_many_recipients');
  end if;
  select array_agg(distinct (e ->> 'district_id')::uuid) filter (where e ->> 'district_id' is not null) into v_districts
    from jsonb_array_elements(v_rows) e where e ->> 'state' = 'ok';

  v_number := private.serial('MSG');
  insert into public.message_campaigns (number, kind, template_code, audience, district_id, district_ids, recipients, status,
                                        note, title, category, lang, body, target, areas, scheduled_at, allow_duplicates,
                                        created_by, decided_at, decided_by)
  values (v_number, 'compose', null, jsonb_build_object('kind', 'compose'),
          case when cardinality(v_districts) = 1 then v_districts[1] end, v_districts, v_ok, 'approved',
          null, v_title, v_category, v_lang, v_body, v_target, private.compose_area_names(v_target), v_at, v_dup,
          auth.uid(), now(), auth.uid())
  returning id into v_id;

  for r in select (e ->> 'party_id')::uuid as party_id, e ->> 'phone' as phone, (e ->> 'district_id')::uuid as district_id, e -> 'vars' as vars
             from jsonb_array_elements(v_rows) e where e ->> 'state' = 'ok' loop
    insert into public.messages (to_address, party_id, lang, body, district_id, related_kind, related_id, dedupe_key,
                                 campaign_id, created_by, run_after)
    values (r.phone, r.party_id, v_lang, private.compose_render(v_body, r.vars), r.district_id, 'campaign', v_id,
            'cmp:' || v_id || ':' || case when v_dup then r.party_id::text else r.phone end,
            v_id, auth.uid(), coalesce(v_at, now()))
    on conflict (dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  update public.message_campaigns set recipients = v_n where id = v_id;

  perform private.audit('message_send', 'message_campaigns', v_id::text, null,
    jsonb_build_object('number', v_number, 'title', v_title, 'category', v_category, 'lang', v_lang, 'target', v_target,
                       'recipients', v_n, 'skipped', jsonb_array_length(v_rows) - v_ok,
                       'scheduled_at', v_at));
  return jsonb_build_object('id', v_id, 'number', v_number, 'queued', v_n, 'scheduled_at', v_at);
end;
$$;

/** Campaign history with delivery counts. p: {q, state, category, from, to, page, size, id}. */
create or replace function public.campaign_list(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce((p ->> 'size')::int, 25), 1), 200);
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v jsonb;
  v_total int;
begin
  perform private.assert_permission('messages.view');
  with c as (
    select m.*, coalesce(k.total, 0) as total, coalesce(k.sent, 0) as sent, coalesce(k.failed, 0) as failed,
           coalesce(k.waiting, 0) as waiting, coalesce(k.cancelled, 0) as cancelled_n,
           case
             when m.status <> 'approved' then m.status::text
             when coalesce(k.waiting, 0) > 0 and m.scheduled_at > now() then 'scheduled'
             when coalesce(k.waiting, 0) > 0 then 'sending'
             when coalesce(k.failed, 0) > 0 and coalesce(k.sent, 0) > 0 then 'partial'
             when coalesce(k.failed, 0) > 0 then 'failed'
             when coalesce(k.total, 0) > 0 and k.cancelled = k.total then 'cancelled'
             else 'sent'
           end as state,
           (select pr.full_name from public.profiles pr where pr.user_id = m.created_by) as sender,
           (select jsonb_build_object('name_so', d.name_so, 'name_en', d.name_en) from public.districts d where d.id = m.district_id) as district
      from public.message_campaigns m
      left join lateral (
        select count(*)::int as total,
               count(*) filter (where ms.status = 'sent')::int as sent,
               count(*) filter (where ms.status = 'failed')::int as failed,
               count(*) filter (where ms.status in ('queued', 'sending'))::int as waiting,
               count(*) filter (where ms.status = 'cancelled')::int as cancelled
          from public.messages ms where ms.campaign_id = m.id
      ) k on true
     where private.campaign_visible(m.district_id, m.district_ids, m.created_by)
       and (p ->> 'id' is null or m.id = (p ->> 'id')::uuid)
       and (v_q is null or m.number ilike '%' || v_q || '%' or m.title ilike '%' || v_q || '%' or m.body ilike '%' || v_q || '%')
       and (p ->> 'category' is null or m.category = p ->> 'category')
       and (p ->> 'from' is null or m.created_at >= (p ->> 'from')::date)
       and (p ->> 'to' is null or m.created_at < (p ->> 'to')::date + 1)
  ),
  f as (select * from c where p ->> 'state' is null or c.state = p ->> 'state')
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
           'id', f.id, 'number', f.number, 'kind', f.kind, 'title', f.title, 'category', f.category, 'lang', f.lang,
           'body', f.body, 'template_code', f.template_code, 'audience', f.audience, 'areas', f.areas, 'target', f.target,
           'district', f.district, 'note', f.note, 'decision_note', f.decision_note, 'status', f.status,
           'created_at', f.created_at, 'created_by', f.created_by, 'scheduled_at', f.scheduled_at, 'sender', f.sender,
           'recipients', f.recipients, 'total', f.total, 'sent', f.sent, 'failed', f.failed, 'waiting', f.waiting,
           'cancelled', f.cancelled_n, 'state', f.state) order by f.created_at desc)
           from (select * from f order by f.created_at desc offset (v_page - 1) * v_size limit v_size) f), '[]'::jsonb)
    into v_total, v;
  return jsonb_build_object('total', v_total, 'rows', v);
end;
$$;

/** Send again every failed message of a campaign. Returns how many. */
create or replace function public.campaign_retry_failed(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.message_campaigns;
  v_n int;
begin
  perform private.assert_permission('messages.update');
  select * into v from public.message_campaigns where id = p_id;
  if not found or not private.campaign_visible(v.district_id, v.district_ids, v.created_by) then
    perform private.raise_app_error('NOT_FOUND', 'campaign');
  end if;
  update public.messages set status = 'queued', attempts = 0, run_after = now(), last_error = null
   where campaign_id = p_id and status = 'failed' and (district_id is null or public.can_access_district(district_id));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_failed');
  end if;
  perform private.audit('message_retry', 'message_campaigns', p_id::text, null, jsonb_build_object('number', v.number, 'retried', v_n));
  return v_n;
end;
$$;

/** Stop the messages of a campaign that have not gone yet (for example a scheduled one). Returns how many. */
create or replace function public.campaign_cancel_waiting(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.message_campaigns;
  v_n int;
begin
  perform private.assert_permission('messages.cancel');
  select * into v from public.message_campaigns where id = p_id;
  if not found or not private.campaign_visible(v.district_id, v.district_ids, v.created_by) then
    perform private.raise_app_error('NOT_FOUND', 'campaign');
  end if;
  update public.messages set status = 'cancelled'
   where campaign_id = p_id and status = 'queued' and (district_id is null or public.can_access_district(district_id));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform private.raise_app_error('CONFLICT', 'nothing_waiting');
  end if;
  perform private.audit('message_cancel', 'message_campaigns', p_id::text, null, jsonb_build_object('number', v.number, 'cancelled', v_n));
  return v_n;
end;
$$;

/** Limit a staff user's messages to some sections, sectors or neighbourhoods (an empty list = their whole districts). */
create or replace function public.admin_set_user_areas(p_user_id uuid, p_areas jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_before jsonb;
  v_n int := 0;
begin
  perform private.assert_permission('users.update');
  if not exists (select 1 from public.profiles where user_id = p_user_id and deleted_at is null) then
    perform private.raise_app_error('NOT_FOUND', 'user');
  end if;
  if jsonb_typeof(coalesce(p_areas, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_areas, '[]'::jsonb)) > 200 then
    perform private.raise_app_error('VALIDATION', 'areas');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('level', level, 'id', area_id)), '[]'::jsonb) into v_before
    from public.user_areas where user_id = p_user_id;
  delete from public.user_areas where user_id = p_user_id;
  for e in select * from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) loop
    if e ->> 'level' not in ('section', 'sector', 'neighbourhood') then
      perform private.raise_app_error('VALIDATION', 'areas');
    end if;
    -- The admin may only hand out areas in districts they reach themselves.
    if not exists (
      select 1 from public.sections s where e ->> 'level' = 'section' and s.id = (e ->> 'id')::uuid and public.can_access_district(s.district_id)
      union all select 1 from public.sectors s join public.sections se on se.id = s.section_id
       where e ->> 'level' = 'sector' and s.id = (e ->> 'id')::uuid and public.can_access_district(se.district_id)
      union all select 1 from public.neighbourhoods n join public.sectors s on s.id = n.sector_id join public.sections se on se.id = s.section_id
       where e ->> 'level' = 'neighbourhood' and n.id = (e ->> 'id')::uuid and public.can_access_district(se.district_id)) then
      perform private.raise_app_error('PERMISSION_DENIED', 'area');
    end if;
    insert into public.user_areas (user_id, level, area_id, assigned_by)
    values (p_user_id, e ->> 'level', (e ->> 'id')::uuid, auth.uid())
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  perform private.audit('user_areas_set', 'user_areas', p_user_id::text, v_before, p_areas);
  return v_n;
end;
$$;

/** A user's messaging areas with their names (for Admin → Users). */
create or replace function public.user_areas_of(p_user_id uuid)
returns table (level text, id uuid, code text, name_so text, name_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.level, a.area_id, coalesce(s.code, se.code, n.code), coalesce(s.name_so, se.name_so, n.name_so), coalesce(s.name_en, se.name_en, n.name_en)
    from public.user_areas a
    left join public.sections s on a.level = 'section' and s.id = a.area_id
    left join public.sectors se on a.level = 'sector' and se.id = a.area_id
    left join public.neighbourhoods n on a.level = 'neighbourhood' and n.id = a.area_id
   where a.user_id = p_user_id and (p_user_id = auth.uid() or public.has_permission('users.view'))
   order by a.level, 3;
$$;

revoke all on function private.sms_phone(text), private.my_areas_limited(), private.area_allowed(text, uuid),
  private.my_owner_land(), private.target_ids(jsonb, text), private.compose_check_target(jsonb),
  private.compose_recipients(jsonb, text, boolean), private.compose_render(text, jsonb), private.compose_area_names(jsonb)
  from public, anon, authenticated;
grant execute on function private.campaign_visible(uuid, uuid[], uuid) to authenticated;

do $do$
declare
  f text;
begin
  foreach f in array array['public.compose_areas(text, uuid)', 'public.compose_search_owners(text)',
                           'public.compose_preview(jsonb, text, text, boolean)', 'public.compose_send(jsonb)',
                           'public.campaign_list(jsonb)', 'public.campaign_retry_failed(uuid)', 'public.campaign_cancel_waiting(uuid)',
                           'public.admin_set_user_areas(uuid, jsonb)', 'public.user_areas_of(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;
