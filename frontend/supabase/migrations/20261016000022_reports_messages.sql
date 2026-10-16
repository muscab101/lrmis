-- ============================================================================
-- 0022 Phase 10: dashboards, reports, message outbox (SMS), campaigns, notifications.
-- Reports are SECURITY DEFINER with an explicit permission check and district filter, so
-- report-only roles (executives, auditors) see totals without row access to the tables.
-- ============================================================================

create type public.message_channel as enum ('sms', 'whatsapp', 'email');
create type public.message_status as enum ('queued', 'sending', 'sent', 'failed', 'cancelled');
create type public.campaign_status as enum ('draft', 'approved', 'rejected', 'cancelled');

insert into public.settings (key, value, description) values
  ('messages.max_attempts', '5', 'How many times the dispatcher retries a message'),
  ('messages.campaign_limit', '5000', 'Most recipients one campaign may reach'),
  ('messages.sender_name', '"LRMIS"', 'Sender name shown in SMS where the provider allows it')
on conflict (key) do nothing;

-- Admins approve bulk SMS campaigns and can cancel queued messages; nothing in the catalogue did.
update public.roles set default_permissions = default_permissions || array['messages.approve', 'messages.cancel']
 where key = 'admin' and not ('messages.approve' = any (default_permissions));
insert into public.role_permissions (role_id, permission_key)
select r.id, p from public.roles r cross join unnest(array['messages.approve', 'messages.cancel']) p where r.key = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Templates: {placeholders} are filled from the event (name, pun, amount, invoice …).
-- ---------------------------------------------------------------------------
create table public.message_templates (
  code         text primary key check (code ~ '^[a-z_]+$'),
  channel      public.message_channel not null default 'sms',
  body_so      text not null check (length(body_so) between 1 and 640),
  body_en      text not null check (length(body_en) between 1 and 640),
  description  text not null default '',
  -- System templates are sent by triggers; campaigns may only use non-system ones.
  is_system    boolean not null default false,
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);

insert into public.message_templates (code, is_system, description, body_so, body_en) values
  ('application_status', true, 'Applicant: application moved to a new step',
   'LRMIS: Codsigaaga {number} hadda waa "{status}". La soco: {link}',
   'LRMIS: Your application {number} is now "{status}". Track it: {link}'),
  ('payment_receipt', true, 'Payer: payment received',
   'LRMIS: Waxaan helnay ${amount}, rasiid {receipt}, dhulka {pun}. Mahadsanid.',
   'LRMIS: We received ${amount}, receipt {receipt}, parcel {pun}. Thank you.'),
  ('certificate_ready', true, 'Owner: title certificate issued',
   'LRMIS: Shahaadada lahaanshaha dhulka {pun} waa diyaar ({serial}). Ka qaado xafiiska degmada.',
   'LRMIS: The title certificate for parcel {pun} is ready ({serial}). Collect it at the district office.'),
  ('overdue_reminder', false, 'Campaign: overdue property tax',
   'LRMIS: {name}, biilka {invoice} ee dhulka {pun} wuxuu ka dambeeyay waqtiga. Haraaga: ${amount}. Fadlan bixi si aad uga badbaadid ganaax.',
   'LRMIS: {name}, invoice {invoice} for parcel {pun} is overdue. Balance: ${amount}. Please pay to avoid penalties.'),
  ('tax_due', false, 'Campaign: tax bill issued',
   'LRMIS: {name}, canshuurta dhulka {pun} ee {period} waa ${amount}, waxaa la bixinayaa {due_date}. Biil {invoice}.',
   'LRMIS: {name}, property tax for parcel {pun} ({period}) is ${amount}, due {due_date}. Invoice {invoice}.'),
  ('general_notice', false, 'Campaign: free-text notice to owners',
   'LRMIS: {text}',
   'LRMIS: {text}');

-- ---------------------------------------------------------------------------
-- Campaigns (bulk sends) need a second person to approve before anything is queued.
-- ---------------------------------------------------------------------------
create table public.message_campaigns (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  template_code  text not null references public.message_templates (code),
  -- {"kind":"overdue","min_days":30} | {"kind":"tax_due","period":"2026"} | {"kind":"owners"}; plus "text" for general notices.
  audience       jsonb not null,
  district_id    uuid references public.districts (id),
  recipients     int not null default 0,
  status         public.campaign_status not null default 'draft',
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decided_by     uuid references auth.users (id) on delete set null,
  decision_note  text
);

create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  channel        public.message_channel not null default 'sms',
  to_address     text not null check (length(to_address) between 3 and 200),
  party_id       uuid references public.parties (id) on delete set null,
  lang           text not null default 'so' check (lang in ('so', 'en')),
  template_code  text references public.message_templates (code),
  body           text not null check (length(body) between 1 and 1000),
  status         public.message_status not null default 'queued',
  attempts       int not null default 0,
  run_after      timestamptz not null default now(),
  provider       text,
  provider_ref   text,
  last_error     text,
  district_id    uuid references public.districts (id),
  related_kind   text,
  related_id     uuid,
  campaign_id    uuid references public.message_campaigns (id),
  dedupe_key     text unique,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,
  sent_at        timestamptz
);
create index messages_pick_idx on public.messages (status, run_after) where status = 'queued';
create index messages_created_idx on public.messages (created_at desc);
create index messages_party_idx on public.messages (party_id);

do $$
declare t text;
begin
  foreach t in array array['message_templates', 'message_campaigns', 'messages'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy message_templates_select on public.message_templates for select to authenticated
  using (public.has_permission('messages.view'));
create policy message_campaigns_select on public.message_campaigns for select to authenticated
  using (public.has_permission('messages.view') and (district_id is null or public.can_access_district(district_id)));
-- Staff see the outbox for their districts; people see messages sent to them.
create policy messages_select on public.messages for select to authenticated
  using (
    (public.has_permission('messages.view') and (district_id is null or public.can_access_district(district_id)))
    or exists (select 1 from public.parties p where p.id = messages.party_id and p.citizen_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Rendering and queueing
-- ---------------------------------------------------------------------------
create or replace function private.render_template(p_code text, p_lang text, p_vars jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_body text;
  k text;
  v text;
begin
  select case when p_lang = 'en' then body_en else body_so end into v_body
    from public.message_templates where code = p_code and active;
  if v_body is null then
    return null;
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    v_body := replace(v_body, '{' || k || '}', coalesce(v, ''));
  end loop;
  return left(v_body, 1000);
end;
$$;

/** Queue one SMS. Silently skips when there is no phone, the template is off, or it was already queued. */
create or replace function private.queue_message(
  p_template text, p_phone text, p_party uuid, p_lang text, p_vars jsonb,
  p_district uuid, p_related_kind text, p_related_id uuid, p_dedupe text, p_campaign uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text;
  v_id uuid;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  v_body := private.render_template(p_template, coalesce(p_lang, 'so'), p_vars);
  if v_body is null then
    return null;
  end if;
  insert into public.messages (to_address, party_id, lang, template_code, body, district_id, related_kind, related_id, dedupe_key, campaign_id, created_by)
  values (p_phone, p_party, coalesce(p_lang, 'so'), p_template, v_body, p_district, p_related_kind, p_related_id, p_dedupe, p_campaign, auth.uid())
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Language preference: the citizen's profile language when they have an account, else Somali.
create or replace function private.party_lang(p_party uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when pr.locale = 'en' then 'en' else 'so' end
                     from public.parties p join public.profiles pr on pr.user_id = p.citizen_user_id
                    where p.id = p_party), 'so');
$$;

-- ---------------------------------------------------------------------------
-- Event triggers: applicant updates, payment receipts, certificates, decisions back to the maker.
-- ---------------------------------------------------------------------------
create or replace function private.on_application_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party public.parties;
  v_label_so text;
  v_label_en text;
begin
  if new.status is not distinct from old.status
     or new.status not in ('awaiting_payment', 'in_survey', 'returned', 'public_notice', 'approved', 'rejected') then
    return new;
  end if;
  v_label_so := case new.status
    when 'awaiting_payment' then 'sugaya lacag-bixin' when 'in_survey' then 'sahan'
    when 'returned' then 'laguu soo celiyay' when 'public_notice' then 'ogeysiis dadweyne'
    when 'approved' then 'la ansixiyay' else 'la diiday' end;
  v_label_en := case new.status
    when 'awaiting_payment' then 'awaiting payment' when 'in_survey' then 'in survey'
    when 'returned' then 'returned to you' when 'public_notice' then 'on public notice'
    when 'approved' then 'approved' else 'rejected' end;
  if new.citizen_user_id is not null then
    perform private.notify(new.citizen_user_id, 'application.' || new.status::text,
      'Codsiga ' || new.number || ': ' || v_label_so, 'Application ' || new.number || ': ' || v_label_en,
      '/portal/applications/' || new.id);
  end if;
  select * into v_party from public.parties where id = new.applicant_party_id;
  if found then
    perform private.queue_message('application_status', v_party.phone, v_party.id, private.party_lang(v_party.id),
      jsonb_build_object('number', new.number, 'status', case when private.party_lang(v_party.id) = 'en' then v_label_en else v_label_so end, 'link', 'lrmis.so/track'),
      new.district_id, 'application', new.id, 'app:' || new.id || ':' || new.status::text);
  end if;
  return new;
end;
$$;
create trigger application_status_message after update of status on public.applications
  for each row execute function private.on_application_status();

create or replace function private.on_payment_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pun text;
  v_party uuid;
begin
  if new.status <> 'completed' or new.payer_phone is null then
    return new;
  end if;
  select pun into v_pun from public.parcels where id = new.parcel_id;
  select id into v_party from public.parties where phone = new.payer_phone order by created_at limit 1;
  perform private.queue_message('payment_receipt', new.payer_phone, v_party, coalesce(private.party_lang(v_party), 'so'),
    jsonb_build_object('amount', to_char(new.amount_base, 'FM999999990.00'), 'receipt', new.receipt_no, 'pun', coalesce(v_pun, '—')),
    new.district_id, 'payment', new.id, 'pay:' || new.id);
  return new;
end;
$$;
create trigger payment_receipt_message after insert on public.payments
  for each row execute function private.on_payment_received();

create or replace function private.on_certificate_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
begin
  if new.type <> 'certificate' then
    return new;
  end if;
  for o in
    select p.id, p.phone, p.citizen_user_id from public.parcel_owners po join public.parties p on p.id = po.party_id
     where po.parcel_id = new.parcel_id and po.valid_to is null
  loop
    perform private.queue_message('certificate_ready', o.phone, o.id, private.party_lang(o.id),
      jsonb_build_object('pun', new.snapshot ->> 'pun', 'serial', new.serial),
      new.district_id, 'document', new.id, 'cert:' || new.id || ':' || o.id);
    if o.citizen_user_id is not null then
      perform private.notify(o.citizen_user_id, 'certificate.issued',
        'Shahaadada ' || coalesce(new.snapshot ->> 'pun', '') || ' waa diyaar', 'Certificate for ' || coalesce(new.snapshot ->> 'pun', '') || ' is ready', '/portal');
    end if;
  end loop;
  return new;
end;
$$;
create trigger certificate_ready_message after insert on public.issued_documents
  for each row execute function private.on_certificate_issued();

-- The officer who created a transfer / permit / parcel change hears about the decision.
create or replace function private.on_request_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maker uuid;
  v_link text;
  v_ok boolean := new.status = 'approved';
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  if tg_table_name = 'transfers' then
    v_maker := new.created_by;
    v_link := '/transfers/' || new.id;
  elsif tg_table_name = 'permits' then
    v_maker := new.requested_by;
    v_link := '/permits';
  else
    v_maker := new.requested_by;
    v_link := '/disputes?s=changes';
  end if;
  if v_maker is not null and v_maker is distinct from auth.uid() then
    perform private.notify(v_maker, 'decision.' || tg_table_name,
      new.number || case when v_ok then ' waa la ansixiyay' else ' waa la diiday' end,
      new.number || case when v_ok then ' was approved' else ' was rejected' end, v_link);
  end if;
  return new;
end;
$$;
create trigger transfers_decided after update of status on public.transfers for each row execute function private.on_request_decided();
create trigger permits_decided after update of status on public.permits for each row execute function private.on_request_decided();
create trigger parcel_changes_decided after update of status on public.parcel_changes for each row execute function private.on_request_decided();

-- ---------------------------------------------------------------------------
-- Templates, campaigns and the outbox
-- ---------------------------------------------------------------------------
create or replace function public.message_template_update(p_code text, p_body_so text, p_body_en text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('messages.update');
  if length(trim(coalesce(p_body_so, ''))) = 0 or length(trim(coalesce(p_body_en, ''))) = 0 then
    perform private.raise_app_error('VALIDATION', 'body');
  end if;
  if length(p_body_so) > 640 or length(p_body_en) > 640 then
    perform private.raise_app_error('VALIDATION', 'body_long');
  end if;
  update public.message_templates
     set body_so = p_body_so, body_en = p_body_en, active = p_active, updated_at = now(), updated_by = auth.uid()
   where code = p_code;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'template');
  end if;
end;
$$;

/** The people a campaign reaches: one row per (party, invoice/parcel) with the template's values. */
create or replace function private.campaign_audience(p_audience jsonb, p_district uuid)
returns table (party_id uuid, phone text, district_id uuid, related_id uuid, vars jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := p_audience ->> 'kind';
begin
  if v_kind = 'overdue' then
    return query
      select distinct on (p.id, i.id) p.id, p.phone, i.district_id, i.id,
             jsonb_build_object('name', split_part(p.full_name, ' ', 1), 'invoice', i.number, 'pun', pc.pun,
                                'amount', to_char(i.balance, 'FM999999990.00'))
        from public.invoices i
        join public.parcels pc on pc.id = i.parcel_id
        join public.parcel_owners po on po.parcel_id = i.parcel_id and po.valid_to is null
        join public.parties p on p.id = po.party_id
       where i.status in ('issued', 'partially_paid') and i.balance > 0
         and i.due_date < current_date - coalesce((p_audience ->> 'min_days')::int, 0)
         and p.phone is not null
         and (p_district is null or i.district_id = p_district)
         and public.can_access_district(i.district_id);
  elsif v_kind = 'tax_due' then
    return query
      select distinct on (p.id, i.id) p.id, p.phone, i.district_id, i.id,
             jsonb_build_object('name', split_part(p.full_name, ' ', 1), 'invoice', i.number, 'pun', pc.pun, 'period', i.period,
                                'amount', to_char(i.balance, 'FM999999990.00'), 'due_date', to_char(i.due_date, 'DD/MM/YYYY'))
        from public.invoices i
        join public.fee_types ft on ft.id = i.fee_type_id and ft.code = 'property_tax'
        join public.parcels pc on pc.id = i.parcel_id
        join public.parcel_owners po on po.parcel_id = i.parcel_id and po.valid_to is null
        join public.parties p on p.id = po.party_id
       where i.status in ('issued', 'partially_paid') and i.balance > 0
         and i.period = coalesce(p_audience ->> 'period', extract(year from current_date)::text)
         and p.phone is not null
         and (p_district is null or i.district_id = p_district)
         and public.can_access_district(i.district_id);
  elsif v_kind = 'owners' then
    return query
      select distinct on (p.id) p.id, p.phone, pc.district_id, null::uuid,
             jsonb_build_object('name', split_part(p.full_name, ' ', 1), 'pun', pc.pun, 'text', coalesce(p_audience ->> 'text', ''))
        from public.parcel_owners po
        join public.parcels pc on pc.id = po.parcel_id and pc.status in ('registered', 'disputed')
        join public.parties p on p.id = po.party_id
       where po.valid_to is null and p.phone is not null
         and (p_district is null or pc.district_id = p_district)
         and public.can_access_district(pc.district_id);
  else
    perform private.raise_app_error('VALIDATION', 'audience');
  end if;
end;
$$;

create or replace function public.campaign_create(p_template text, p_audience jsonb, p_district uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n int;
  v_t public.message_templates;
begin
  perform private.assert_permission('messages.create');
  select * into v_t from public.message_templates where code = p_template;
  if not found or v_t.is_system or not v_t.active then
    perform private.raise_app_error('VALIDATION', 'template');
  end if;
  if p_template = 'general_notice' then
    if length(trim(coalesce(p_audience ->> 'text', ''))) < 10 or length(p_audience ->> 'text') > 400 then
      perform private.raise_app_error('VALIDATION', 'text');
    end if;
    p_audience := jsonb_build_object('kind', 'owners', 'text', trim(p_audience ->> 'text'));
  end if;
  if p_district is not null and not public.can_access_district(p_district) then
    perform private.raise_app_error('PERMISSION_DENIED', 'district');
  end if;
  if p_district is null and not private.user_has_all_districts(auth.uid()) then
    -- Only users with access to every district may target all of them.
    perform private.raise_app_error('VALIDATION', 'district');
  end if;
  select count(*) into v_n from private.campaign_audience(p_audience, p_district);
  if v_n = 0 then
    perform private.raise_app_error('VALIDATION', 'no_recipients');
  end if;
  if v_n > private.setting_int('messages.campaign_limit', 5000) then
    perform private.raise_app_error('VALIDATION', 'too_many_recipients');
  end if;
  insert into public.message_campaigns (number, template_code, audience, district_id, recipients, note, created_by)
  values (private.serial('MSG'), p_template, p_audience, p_district, v_n, nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'recipients', v_n);
end;
$$;

create or replace function public.campaign_decide(p_id uuid, p_approve boolean, p_note text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.message_campaigns;
  r record;
  v_n int := 0;
begin
  perform private.assert_permission('messages.approve');
  select * into v from public.message_campaigns where id = p_id for update;
  if not found or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'campaign');
  end if;
  if v.status <> 'draft' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.created_by);
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 3 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.message_campaigns set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = p_note where id = p_id;
    return 0;
  end if;
  for r in select * from private.campaign_audience(v.audience, v.district_id) loop
    if private.queue_message(v.template_code, r.phone, r.party_id, private.party_lang(r.party_id), r.vars,
         r.district_id, 'campaign', r.related_id, 'cmp:' || v.id || ':' || r.party_id || ':' || coalesce(r.related_id::text, ''), v.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  update public.message_campaigns
     set status = 'approved', recipients = v_n, decided_at = now(), decided_by = auth.uid(), decision_note = nullif(trim(p_note), '')
   where id = p_id;
  return v_n;
end;
$$;

create or replace function public.campaign_preview(p_template text, p_audience jsonb, p_district uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_sample jsonb;
begin
  perform private.assert_permission('messages.create');
  if p_template = 'general_notice' then
    p_audience := jsonb_build_object('kind', 'owners', 'text', coalesce(p_audience ->> 'text', ''));
  end if;
  select count(*), (array_agg(vars))[1] into v_n, v_sample from private.campaign_audience(p_audience, p_district);
  return jsonb_build_object('recipients', v_n,
    'sample_so', private.render_template(p_template, 'so', v_sample), 'sample_en', private.render_template(p_template, 'en', v_sample));
end;
$$;

create or replace function public.message_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('messages.update');
  update public.messages set status = 'queued', attempts = 0, run_after = now(), last_error = null
   where id = p_id and status in ('failed', 'cancelled') and (district_id is null or public.can_access_district(district_id));
  if not found then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
end;
$$;

create or replace function public.message_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('messages.cancel');
  update public.messages set status = 'cancelled'
   where id = p_id and status = 'queued' and (district_id is null or public.can_access_district(district_id));
  if not found then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
end;
$$;

-- Dispatcher (service role only): claim a batch, then report each result.
create or replace function public.messages_claim(p_limit int)
returns setof public.messages
language sql
security definer
set search_path = ''
as $$
  update public.messages m set status = 'sending', attempts = attempts + 1
   where m.id in (select id from public.messages where status = 'queued' and run_after <= now()
                   order by created_at limit least(greatest(p_limit, 1), 200) for update skip locked)
  returning m.*;
$$;

create or replace function public.message_result(p_id uuid, p_ok boolean, p_provider text, p_ref text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int := private.setting_int('messages.max_attempts', 5);
begin
  update public.messages
     set status = case when p_ok then 'sent'::public.message_status
                       when attempts >= v_max then 'failed'::public.message_status
                       else 'queued'::public.message_status end,
         -- Back off 1, 4, 9 … minutes between attempts.
         run_after = case when p_ok then run_after else now() + make_interval(mins => attempts * attempts) end,
         provider = p_provider, provider_ref = coalesce(p_ref, provider_ref),
         last_error = case when p_ok then null else left(p_error, 500) end,
         sent_at = case when p_ok then now() else sent_at end
   where id = p_id and status = 'sending';
end;
$$;

-- Messages stuck in "sending" (a crashed dispatcher) go back to the queue after 10 minutes.
create or replace function public.messages_requeue_stale()
returns int
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.messages set status = 'queued' where status = 'sending' and run_after < now() - interval '10 minutes' returning 1
  ) select count(*)::int from u;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard and reports
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_month date := date_trunc('month', current_date)::date;
  v_year date := date_trunc('year', current_date)::date;
  v_fin boolean := public.has_permission('reports.view') or public.has_permission('invoices.view') or public.has_permission('payments.view');
begin
  if v_uid is null or not public.has_permission('dashboard.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'dashboard');
  end if;

  if public.has_permission('applications.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('applications', (
      select jsonb_build_object(
        'open', count(*) filter (where status not in ('draft', 'approved', 'rejected', 'cancelled')),
        'submitted_month', count(*) filter (where submitted_at >= v_month),
        'by_status', coalesce((select jsonb_object_agg(s, n) from (
            select status::text s, count(*) n from public.applications a2
             where public.can_access_district(a2.district_id) and status not in ('draft', 'cancelled') group by 1) x), '{}'::jsonb))
        from public.applications a where public.can_access_district(a.district_id)));
  end if;

  if public.has_permission('parcels.view') or public.has_permission('reports.view') then
    v_out := v_out || jsonb_build_object('parcels', (
      select jsonb_build_object(
        'registered', count(*) filter (where status in ('registered', 'disputed')),
        'registered_month', count(*) filter (where registered_at >= v_month),
        'disputed', count(*) filter (where status = 'disputed'),
        'area_ha', round(coalesce(sum(area_m2) filter (where status in ('registered', 'disputed')), 0) / 10000, 1))
        from public.parcels p where p.deleted_at is null and public.can_access_district(p.district_id)));
  end if;

  if v_fin then
    v_out := v_out || jsonb_build_object('finance', jsonb_build_object(
      'collected_month', (select coalesce(sum(amount_base), 0) from public.payments
                           where status = 'completed' and received_at >= v_month and (district_id is null or public.can_access_district(district_id))),
      'collected_year', (select coalesce(sum(amount_base), 0) from public.payments
                          where status = 'completed' and received_at >= v_year and (district_id is null or public.can_access_district(district_id))),
      'outstanding', (select coalesce(sum(balance), 0) from public.invoices
                       where status in ('issued', 'partially_paid') and public.can_access_district(district_id)),
      'overdue', (select coalesce(sum(balance), 0) from public.invoices
                   where status in ('issued', 'partially_paid') and due_date < current_date and public.can_access_district(district_id)),
      'billed_year', (select coalesce(sum(total), 0) from public.invoices
                       where status <> 'cancelled' and issue_date >= v_year and public.can_access_district(district_id)),
      'paid_year', (select coalesce(sum(paid + credited), 0) from public.invoices
                     where status <> 'cancelled' and issue_date >= v_year and public.can_access_district(district_id)),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'amount', coalesce(x.amount, 0)) order by m), '[]'::jsonb)
                  from generate_series(v_month - interval '5 months', v_month, interval '1 month') m
                  left join (select date_trunc('month', received_at) mm, sum(amount_base) amount from public.payments
                              where status = 'completed' and received_at >= v_month - interval '5 months'
                                and (district_id is null or public.can_access_district(district_id)) group by 1) x on x.mm = m)));
  end if;

  -- What is waiting for me. Items I created myself are excluded where a second person must decide.
  v_out := v_out || jsonb_build_object('tasks', jsonb_build_object(
    'surveys', (select count(*) from public.surveys where surveyor_id = v_uid and status in ('assigned', 'in_progress', 'returned')),
    'transfers', case when public.has_permission('transfers.approve') then
        (select count(*) from public.transfers where status = 'submitted' and created_by is distinct from v_uid and public.can_access_district(district_id)) else 0 end,
    'permits', case when public.has_permission('permits.approve') then
        (select count(*) from public.permits where status = 'submitted' and requested_by is distinct from v_uid and public.can_access_district(district_id)) else 0 end,
    'changes', case when public.has_permission('parcels.approve') then
        (select count(*) from public.parcel_changes where status = 'submitted' and requested_by is distinct from v_uid and public.can_access_district(district_id)) else 0 end,
    'disputes', case when public.has_permission('disputes.approve') then
        (select count(*) from public.disputes where status = 'open' and public.can_access_district(district_id)) else 0 end,
    'campaigns', case when public.has_permission('messages.approve') then
        (select count(*) from public.message_campaigns where status = 'draft' and created_by is distinct from v_uid) else 0 end,
    'messages_failed', case when public.has_permission('messages.view') then
        (select count(*) from public.messages where status = 'failed' and (district_id is null or public.can_access_district(district_id))) else 0 end));
  return v_out;
end;
$$;

create or replace function private.assert_report(p_from date, p_to date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('reports.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'reports');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    perform private.raise_app_error('VALIDATION', 'date_range');
  end if;
end;
$$;

/** Money received per month and fee type (allocated amounts; unallocated credit shown as its own line). */
create or replace function public.report_revenue(p_from date, p_to date, p_district uuid default null)
returns table (month text, fee_type text, fee_name_so text, fee_name_en text, amount numeric, payments bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), ft.code, ft.name_so, ft.name_en, sum(a.amount)::numeric, count(distinct p.id)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.status = 'completed'
      join public.invoices i on i.id = a.invoice_id
      join public.fee_types ft on ft.id = i.fee_type_id
     where p.received_at >= p_from and p.received_at < p_to + 1
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
     group by 1, 2, 3, 4
    union all
    select to_char(date_trunc('month', p.received_at), 'YYYY-MM'), 'credit', 'Lacag aan la qoondeyn', 'Unallocated credit', sum(p.unallocated)::numeric, count(*)
      from public.payments p
     where p.status = 'completed' and p.unallocated > 0 and p.received_at >= p_from and p.received_at < p_to + 1
       and (p.district_id is null or public.can_access_district(p.district_id)) and (p_district is null or p.district_id = p_district)
     group by 1
     order by 1, 2;
end;
$$;

/** Open balances by district and age past the due date. */
create or replace function public.report_arrears(p_district uuid default null)
returns table (district_id uuid, district_so text, district_en text, invoices bigint, not_due numeric, d1_30 numeric, d31_90 numeric, d91_180 numeric, d180 numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select d.id, d.name_so, d.name_en, count(*),
           coalesce(sum(i.balance) filter (where i.due_date >= current_date), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 1 and 30), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 31 and 90), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date between 91 and 180), 0),
           coalesce(sum(i.balance) filter (where current_date - i.due_date > 180), 0),
           sum(i.balance)
      from public.invoices i join public.districts d on d.id = i.district_id
     where i.status in ('issued', 'partially_paid') and i.balance > 0
       and public.can_access_district(i.district_id) and (p_district is null or i.district_id = p_district)
     group by d.id, d.name_so, d.name_en
     order by sum(i.balance) desc;
end;
$$;

/** Billed vs collected per district for invoices issued in the range. */
create or replace function public.report_collection(p_from date, p_to date)
returns table (district_id uuid, district_so text, district_en text, invoices bigint, billed numeric, collected numeric, credited numeric, outstanding numeric, rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select d.id, d.name_so, d.name_en, count(*), sum(i.total), sum(i.paid), sum(i.credited), sum(i.balance),
           case when sum(i.total) > 0 then round(100 * sum(i.paid + i.credited) / sum(i.total), 1) else 0 end
      from public.invoices i join public.districts d on d.id = i.district_id
     where i.status <> 'cancelled' and i.issue_date between p_from and p_to and public.can_access_district(i.district_id)
     group by d.id, d.name_so, d.name_en
     order by d.name_en;
end;
$$;

/** Applications in and parcels registered per month, with the median days from submission to registration. */
create or replace function public.report_registrations(p_from date, p_to date, p_district uuid default null)
returns table (month text, submitted bigint, registered bigint, rejected bigint, median_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    with months as (
      select to_char(m, 'YYYY-MM') m from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
    ), sub as (
      select to_char(a.submitted_at, 'YYYY-MM') m, count(*) n from public.applications a
       where a.submitted_at >= p_from and a.submitted_at < p_to + 1 and public.can_access_district(a.district_id)
         and (p_district is null or a.district_id = p_district) group by 1
    ), rej as (
      select to_char(a.decided_at, 'YYYY-MM') m, count(*) n from public.applications a
       where a.status = 'rejected' and a.decided_at >= p_from and a.decided_at < p_to + 1 and public.can_access_district(a.district_id)
         and (p_district is null or a.district_id = p_district) group by 1
    ), reg as (
      select to_char(p.registered_at, 'YYYY-MM') m, count(*) n,
             percentile_cont(0.5) within group (order by extract(epoch from p.registered_at - a.submitted_at) / 86400) md
        from public.parcels p left join public.applications a on a.id = p.application_id
       where p.registered_at >= p_from and p.registered_at < p_to + 1 and public.can_access_district(p.district_id)
         and (p_district is null or p.district_id = p_district) group by 1
    )
    select months.m, coalesce(sub.n, 0), coalesce(reg.n, 0), coalesce(rej.n, 0), round(reg.md::numeric, 1)
      from months left join sub using (m) left join reg using (m) left join rej using (m)
     order by 1;
end;
$$;

/** Cashier performance: shifts, takings and cash differences in the range. */
create or replace function public.report_cashiers(p_from date, p_to date)
returns table (cashier_id uuid, cashier_name text, shifts bigint, payments bigint, amount numeric, difference numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select s.cashier_id, pr.full_name, count(distinct s.id),
           (select count(*) from public.payments p where p.shift_id = any (array_agg(s.id)) and p.status = 'completed'),
           (select coalesce(sum(p.amount_base), 0) from public.payments p where p.shift_id = any (array_agg(s.id)) and p.status = 'completed'),
           coalesce(sum(s.difference), 0)
      from public.cashier_shifts s join public.profiles pr on pr.user_id = s.cashier_id
     where s.opened_at >= p_from and s.opened_at < p_to + 1 and (s.district_id is null or public.can_access_district(s.district_id))
     group by s.cashier_id, pr.full_name
     order by 5 desc;
end;
$$;

grant execute on function
  public.message_template_update(text, text, text, boolean), public.campaign_create(text, jsonb, uuid, text),
  public.campaign_decide(uuid, boolean, text), public.campaign_preview(text, jsonb, uuid),
  public.message_retry(uuid), public.message_cancel(uuid), public.dashboard_kpis(),
  public.report_revenue(date, date, uuid), public.report_arrears(uuid), public.report_collection(date, date),
  public.report_registrations(date, date, uuid), public.report_cashiers(date, date)
to authenticated;
revoke execute on function
  public.message_template_update(text, text, text, boolean), public.campaign_create(text, jsonb, uuid, text),
  public.campaign_decide(uuid, boolean, text), public.campaign_preview(text, jsonb, uuid),
  public.message_retry(uuid), public.message_cancel(uuid), public.dashboard_kpis(),
  public.report_revenue(date, date, uuid), public.report_arrears(uuid), public.report_collection(date, date),
  public.report_registrations(date, date, uuid), public.report_cashiers(date, date)
from public, anon;
revoke execute on function public.messages_claim(int), public.message_result(uuid, boolean, text, text, text), public.messages_requeue_stale()
from public, anon, authenticated;
grant execute on function public.messages_claim(int), public.message_result(uuid, boolean, text, text, text), public.messages_requeue_stale() to service_role;
revoke execute on function private.render_template(text, text, jsonb),
  private.queue_message(text, text, uuid, text, jsonb, uuid, text, uuid, text, uuid), private.party_lang(uuid),
  private.campaign_audience(jsonb, uuid), private.assert_report(date, date),
  private.on_application_status(), private.on_payment_received(), private.on_certificate_issued(), private.on_request_decided()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('requeue-stale-messages', '*/10 * * * *', 'select public.messages_requeue_stale()');
  end if;
end $$;
