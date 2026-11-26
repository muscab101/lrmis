-- Messages to owners, part 2 (owner's request, 2026-11-26):
-- * "All owners": every owner with land the sender looks after (target {"all": true}).
-- * Email as well as SMS: channel 'email' goes to the owner's email; the title is the subject.
-- * One message per property instead of one per owner (per_parcel): each message names that one land and its tax.
-- * Placeholders also in the {OwnerName} {ParcelID} {TaxAmount} {DueDate} {District} {Neighbourhood} {Balance} style.
-- * The check returns the first owner's values, so the screen can show the message filled in while it is typed.
-- * The campaign keeps the template it started from and how it was sent.

alter table public.messages add column if not exists subject text;
alter table public.messages drop constraint if exists messages_subject_check;
alter table public.messages add constraint messages_subject_check check (subject is null or length(subject) <= 200);
alter table public.message_campaigns
  add column if not exists channel public.message_channel not null default 'sms',
  add column if not exists per_parcel boolean not null default false;

/** An email address that looks deliverable, lower-cased, or null. */
create or replace function private.clean_email(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when lower(trim(coalesce(p, ''))) ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then lower(trim(p)) end;
$$;

drop function if exists private.compose_recipients(jsonb, text, boolean);
drop function if exists public.compose_preview(jsonb, text, text, boolean);

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
  if v_n = 0 and cardinality(private.target_ids(p_target, 'owners')) = 0 and coalesce((p_target ->> 'all')::boolean, false) is false then
    perform private.raise_app_error('VALIDATION', 'no_target');
  end if;
end;
$$;

/**
 * Who a target reaches: one row per owner (or per owner and land when p_per_parcel), the address for the channel,
 * whether it can be used, and the placeholder values. A phone or email shared by two owners counts once unless
 * p_allow_dup; with p_per_parcel one owner still gets one message per land.
 */
create or replace function private.compose_recipients(p_target jsonb, p_lang text, p_allow_dup boolean,
                                                      p_per_parcel boolean default false, p_channel text default 'sms')
returns table (party_id uuid, parcel_id uuid, full_name text, address_raw text, address text, state text,
               district_id uuid, vars jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with land as (
    select l.* from private.my_owner_land() l
     where coalesce((p_target ->> 'all')::boolean, false)
        or l.party_id = any (private.target_ids(p_target, 'owners'))
        or l.district_id = any (private.target_ids(p_target, 'districts'))
        or l.section_id = any (private.target_ids(p_target, 'sections'))
        or l.sector_id = any (private.target_ids(p_target, 'sectors'))
        or l.neighbourhood_id = any (private.target_ids(p_target, 'neighbourhoods'))
  ),
  keyed as (
    select distinct l.party_id, case when p_per_parcel then l.parcel_id end as unit, l.parcel_id, l.label, l.district_id, l.neighbourhood_id
      from land l
  ),
  money as (
    select k.party_id, k.unit,
           sum(i.total) filter (where ft.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
                                  and i.period = extract(year from current_date)::text) as tax,
           sum(i.balance) filter (where i.status in ('issued', 'partially_paid')) as owing,
           min(i.due_date) filter (where i.status in ('issued', 'partially_paid') and i.balance > 0) as due
      from keyed k
      join public.invoices i on i.parcel_id = k.parcel_id
      left join public.fee_types ft on ft.id = i.fee_type_id
     group by k.party_id, k.unit
  ),
  owners as (
    select k.party_id, k.unit,
           array_agg(distinct k.label) filter (where k.label is not null) as labels,
           (array_agg(k.district_id order by k.label))[1] as district_id,
           (array_agg(k.neighbourhood_id order by k.label) filter (where k.neighbourhood_id is not null))[1] as nb_id
      from keyed k group by k.party_id, k.unit
  ),
  people as (
    select o.party_id, o.unit, o.labels, o.district_id, p.full_name,
           case when p_channel = 'email' then p.email else p.phone end as address_raw,
           case when p_channel = 'email' then private.clean_email(p.email) else private.sms_phone(p.phone) end as address,
           case when p_lang = 'en' then d.name_en else d.name_so end as dname,
           case when p_lang = 'en' then nb.name_en else nb.name_so end as nbname,
           m.tax, m.owing, m.due
      from owners o
      join public.parties p on p.id = o.party_id and p.deleted_at is null
      left join public.districts d on d.id = o.district_id
      left join public.neighbourhoods nb on nb.id = o.nb_id
      left join money m on m.party_id = o.party_id and m.unit is not distinct from o.unit
  ),
  ranked as (
    -- The first owner (by name) on an address keeps it; other owners on the same address are duplicates.
    select people.*, dense_rank() over (partition by people.address order by people.full_name, people.party_id) as rn from people
  )
  select r.party_id, r.unit, r.full_name, r.address_raw, r.address,
         case when nullif(trim(coalesce(r.address_raw, '')), '') is null then 'missing'
              when r.address is null then 'invalid'
              when r.rn > 1 and not p_allow_dup then 'duplicate'
              else 'ok' end,
         r.district_id,
         jsonb_build_object(
           'owner_name', r.full_name,
           'property_number', x.props,
           'district_name', coalesce(r.dname, ''),
           'neighbourhood_name', coalesce(r.nbname, ''),
           'tax_amount', x.tax,
           'outstanding_balance', x.owing,
           'payment_deadline', x.due,
           -- The same values under the other names people write.
           'OwnerName', r.full_name, 'ParcelID', x.props, 'TaxAmount', x.tax, 'Balance', x.owing, 'DueDate', x.due,
           'District', coalesce(r.dname, ''), 'Neighbourhood', coalesce(r.nbname, ''))
    from ranked r
    cross join lateral (select
      coalesce(array_to_string(r.labels[1:3], ', ')
               || case when cardinality(r.labels) > 3 then ' +' || (cardinality(r.labels) - 3) else '' end, '') as props,
      to_char(coalesce(r.tax, 0), 'FM999999990.00') || ' USD' as tax,
      to_char(coalesce(r.owing, 0), 'FM999999990.00') || ' USD' as owing,
      coalesce(to_char(r.due, 'DD/MM/YYYY'), '') as due) x;
$$;

/** The check before sending: counts, problems, the areas, the first owner's values and their message. */
create or replace function public.compose_preview(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target jsonb := coalesce(p -> 'target', '{}'::jsonb);
  v_channel text := coalesce(p ->> 'channel', 'sms');
  v_body text := coalesce(p ->> 'body', '');
  v jsonb;
  v_first jsonb;
begin
  perform private.assert_permission('messages.create');
  if v_channel not in ('sms', 'email') then
    perform private.raise_app_error('VALIDATION', 'channel');
  end if;
  perform private.compose_check_target(v_target);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.state = 'ok', r.full_name), '[]'::jsonb) into v
    from private.compose_recipients(v_target, coalesce(p ->> 'lang', 'so'), coalesce((p ->> 'allow_duplicates')::boolean, false),
                                    coalesce((p ->> 'per_parcel')::boolean, false), v_channel) r;
  select e -> 'vars' into v_first from jsonb_array_elements(v) e where e ->> 'state' = 'ok' limit 1;
  if exists (select 1 from unnest(private.target_ids(v_target, 'owners')) o
              where not exists (select 1 from jsonb_array_elements(v) e where (e ->> 'party_id')::uuid = o)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owner');
  end if;
  return jsonb_build_object(
    'owners', (select count(distinct e ->> 'party_id') from jsonb_array_elements(v) e),
    'messages', jsonb_array_length(v),
    'valid', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'ok'),
    'missing', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'missing'),
    'invalid', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'invalid'),
    'duplicates', (select count(*) from jsonb_array_elements(v) e where e ->> 'state' = 'duplicate'),
    'areas', private.compose_area_names(v_target),
    'all', coalesce((v_target ->> 'all')::boolean, false),
    'sample_vars', v_first,
    'sample', case when v_first is not null and length(v_body) > 0 then private.compose_render(v_body, v_first) end,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('party_id', e -> 'party_id', 'parcel_id', e -> 'parcel_id', 'name', e -> 'full_name',
                                       'address', coalesce(e ->> 'address', e ->> 'address_raw'), 'state', e -> 'state')), '[]'::jsonb)
               from (select e from jsonb_array_elements(v) e limit 300) x));
end;
$$;

/**
 * Sends (or schedules) a message to the owners of a target. expect = the good addresses the sender saw in the check:
 * if it has changed since, nothing is sent (CONFLICT recipients_changed).
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
  v_channel text := coalesce(p ->> 'channel', 'sms');
  v_body text := trim(coalesce(p ->> 'body', ''));
  v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
  v_category text := coalesce(p ->> 'category', 'custom');
  v_template text := nullif(p ->> 'template', '');
  v_at timestamptz := nullif(p ->> 'scheduled_at', '')::timestamptz;
  v_dup boolean := coalesce((p ->> 'allow_duplicates')::boolean, false);
  v_per boolean := coalesce((p ->> 'per_parcel')::boolean, false);
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
  if v_channel not in ('sms', 'email') then
    perform private.raise_app_error('VALIDATION', 'channel');
  end if;
  if length(v_body) < 2 then
    perform private.raise_app_error('VALIDATION', 'body');
  end if;
  if length(v_body) > (case when v_channel = 'email' then 1000 else 640 end) then
    perform private.raise_app_error('VALIDATION', 'body_long');
  end if;
  if length(coalesce(v_title, '')) > 120 then
    perform private.raise_app_error('VALIDATION', 'title');
  end if;
  if v_category not in ('tax_reminder', 'tax_invoice', 'payment_confirmation', 'outstanding_tax', 'general', 'government', 'custom') then
    perform private.raise_app_error('VALIDATION', 'category');
  end if;
  if v_template is not null and not exists (select 1 from public.message_templates where code = v_template and category is not null) then
    v_template := null;
  end if;
  if v_at is not null and (v_at < now() - interval '5 minutes' or v_at > now() + interval '90 days') then
    perform private.raise_app_error('VALIDATION', 'scheduled_at');
  end if;
  if v_at is not null and v_at <= now() then
    v_at := null;
  end if;
  perform private.compose_check_target(v_target);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
    from private.compose_recipients(v_target, v_lang, v_dup, v_per, v_channel) x;
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
                                        title, category, lang, body, target, areas, scheduled_at, allow_duplicates,
                                        channel, per_parcel, created_by, decided_at, decided_by)
  values (v_number, 'compose', v_template, jsonb_build_object('kind', case when coalesce((v_target ->> 'all')::boolean, false) then 'all' else 'compose' end),
          case when cardinality(v_districts) = 1 then v_districts[1] end, v_districts, v_ok, 'approved',
          v_title, v_category, v_lang, v_body, v_target, private.compose_area_names(v_target), v_at, v_dup,
          v_channel::public.message_channel, v_per, auth.uid(), now(), auth.uid())
  returning id into v_id;

  for r in select (e ->> 'party_id')::uuid as party_id, (e ->> 'parcel_id')::uuid as parcel_id, e ->> 'address' as address,
                  (e ->> 'district_id')::uuid as district_id, e -> 'vars' as vars
             from jsonb_array_elements(v_rows) e where e ->> 'state' = 'ok' loop
    insert into public.messages (channel, to_address, subject, party_id, lang, body, template_code, district_id, related_kind,
                                 related_id, dedupe_key, campaign_id, created_by, run_after)
    values (v_channel::public.message_channel, r.address,
            case when v_channel = 'email' then coalesce(v_title, 'Dhulka') end,
            r.party_id, v_lang, private.compose_render(v_body, r.vars), v_template, r.district_id,
            case when r.parcel_id is not null then 'parcel' else 'campaign' end, coalesce(r.parcel_id, v_id),
            'cmp:' || v_id || ':' || case when v_dup then r.party_id::text else r.address end || coalesce(':' || r.parcel_id, ''),
            v_id, auth.uid(), coalesce(v_at, now()))
    on conflict (dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  update public.message_campaigns set recipients = v_n where id = v_id;

  perform private.audit('message_send', 'message_campaigns', v_id::text, null,
    jsonb_build_object('number', v_number, 'title', v_title, 'category', v_category, 'lang', v_lang, 'channel', v_channel,
                       'template', v_template, 'per_parcel', v_per, 'target', v_target,
                       'recipients', v_n, 'skipped', jsonb_array_length(v_rows) - v_ok, 'scheduled_at', v_at));
  return jsonb_build_object('id', v_id, 'number', v_number, 'queued', v_n, 'scheduled_at', v_at);
end;
$$;

-- The history also says how it was sent.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.campaign_list(jsonb)'::regprocedure);
  n := replace(d, $a$'cancelled', f.cancelled_n, 'state', f.state)$a$,
                  $b$'cancelled', f.cancelled_n, 'state', f.state, 'channel', f.channel, 'per_parcel', f.per_parcel)$b$);
  if n = d then
    raise exception 'campaign_list: anchor not found';
  end if;
  execute n;
end;
$do$;

revoke all on function private.clean_email(text), private.compose_recipients(jsonb, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.compose_preview(jsonb) from public, anon;
grant execute on function public.compose_preview(jsonb) to authenticated;
