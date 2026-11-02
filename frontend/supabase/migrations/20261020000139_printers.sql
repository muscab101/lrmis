-- Certificates and ID cards print only on added printers (owner decision 2026-11-02). A browser cannot be limited to
-- one printer, so official copies go through a print program on the office computer: the Print button queues a job for
-- a chosen printer, the program signs in with that printer's own secret key, prints and reports back. The old
-- browser print path is closed. Keys are shown once and stored only as a hash. MAC and IP are never used to sign in;
-- they only raise alerts when they stop matching.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('certificates.printers', 'certificates', 'printers', true, 'Add and manage printers', 'Ku dar oo maamul daabacayaasha', 364)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'certificates.printers' from public.roles r where r.key = 'admin'
on conflict do nothing;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['certificates.printers']) x)
 where key = 'admin';

create table public.printers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null check (length(trim(name)) >= 2),
  manufacturer     text not null,
  model            text not null,
  serial_no        text not null unique check (serial_no ~ '^[A-Z0-9][A-Z0-9-]{3,39}$'),
  mac_address      text unique check (mac_address ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ip_address       text unique,
  connection_type  text not null check (connection_type in ('usb', 'ethernet', 'wifi')),
  system_name      text not null,
  location         text not null,
  department       text,
  district_id      uuid references public.districts (id),
  active           boolean not null default true,
  agent_last_seen  timestamptz,
  agent_ip         text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (connection_type = 'usb' or (mac_address is not null and ip_address is not null))
);
alter table public.printers enable row level security;
create trigger audit after insert or update or delete on public.printers for each row execute function private.audit_row();

-- Apart from printers so the audit log and page reads never carry the hash.
create table public.printer_keys (
  printer_id  uuid primary key references public.printers (id) on delete cascade,
  key_hash    text not null unique,
  created_at  timestamptz not null default now()
);
alter table public.printer_keys enable row level security;

create table public.printer_queue (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.issued_documents (id),
  printer_id    uuid not null references public.printers (id),
  status        text not null default 'queued' check (status in ('queued', 'printing', 'printed', 'failed')),
  locale        text not null default 'so' check (locale in ('so', 'en')),
  requested_by  uuid references auth.users (id) on delete set null,
  requested_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  token_hash    text unique
);
alter table public.printer_queue enable row level security;
create unique index printer_queue_one_open on public.printer_queue (document_id) where status in ('queued', 'printing');
create index printer_queue_printer_idx on public.printer_queue (printer_id, status, requested_at);

create table public.printer_alerts (
  id           uuid primary key default gen_random_uuid(),
  printer_id   uuid references public.printers (id) on delete cascade,
  kind         text not null check (kind in ('bad_key', 'inactive_printer_used', 'agent_moved', 'network_changed', 'printer_missing')),
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id) on delete set null
);
alter table public.printer_alerts enable row level security;
create index printer_alerts_open_idx on public.printer_alerts (at desc) where resolved_at is null;

/** One open alert per printer and kind (a bad key: per address), so a repeating problem does not flood the list. */
create or replace function private.printer_alert(p_printer uuid, p_kind text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.printer_alerts a
                  where a.resolved_at is null and a.kind = p_kind and a.printer_id is not distinct from p_printer
                    and (p_printer is not null or a.detail ->> 'ip' is not distinct from p_detail ->> 'ip')) then
    insert into public.printer_alerts (printer_id, kind, detail) values (p_printer, p_kind, coalesce(p_detail, '{}'::jsonb));
  end if;
end;
$$;

create or replace function private.printer_key_hash(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
$$;

/** The first-print record: count, log and history. */
create or replace function private.document_record_print(p_id uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
begin
  select * into v from public.issued_documents where id = p_id for update;
  update public.issued_documents set print_count = print_count + 1 where id = p_id;
  insert into public.print_jobs (document_id, kind, printed_by) values (p_id, case when v.replaces_id is null then 'original' else 'reprint' end, p_by);
  perform private.parcel_event(v.parcel_id, v.type::text || '_printed', null, jsonb_build_object('document_id', p_id, 'serial', v.serial));
  return jsonb_build_object('serial', v.serial, 'print_count', v.print_count + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Managing printers
-- ---------------------------------------------------------------------------
create or replace function public.printer_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_conn text := p ->> 'connection_type';
  v_serial text := upper(trim(coalesce(p ->> 'serial_no', '')));
  v_mac text := nullif(upper(replace(trim(coalesce(p ->> 'mac_address', '')), '-', ':')), '');
  v_ip text := nullif(trim(coalesce(p ->> 'ip_address', '')), '');
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_inet inet;
begin
  perform private.assert_permission('certificates.printers');
  if v_serial !~ '^[A-Z0-9][A-Z0-9-]{3,39}$' then
    perform private.raise_app_error('VALIDATION', 'serial_no');
  end if;
  if v_conn is null or v_conn not in ('usb', 'ethernet', 'wifi') then
    perform private.raise_app_error('VALIDATION', 'connection_type');
  end if;
  if v_mac is not null and v_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then
    perform private.raise_app_error('VALIDATION', 'mac_address');
  end if;
  if v_ip is not null then
    begin
      v_inet := v_ip::inet;
    exception when others then
      perform private.raise_app_error('VALIDATION', 'ip_address');
    end;
    if masklen(v_inet) <> (case when family(v_inet) = 4 then 32 else 128 end) then
      perform private.raise_app_error('VALIDATION', 'ip_address');
    end if;
    v_ip := host(v_inet);
  end if;
  if v_conn <> 'usb' and v_mac is null then
    perform private.raise_app_error('VALIDATION', 'mac_address');
  end if;
  if v_conn <> 'usb' and v_ip is null then
    perform private.raise_app_error('VALIDATION', 'ip_address');
  end if;
  if length(trim(coalesce(p ->> 'name', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'name');
  end if;
  if length(trim(coalesce(p ->> 'manufacturer', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'manufacturer');
  end if;
  if length(trim(coalesce(p ->> 'model', ''))) < 1 then
    perform private.raise_app_error('VALIDATION', 'model');
  end if;
  if length(trim(coalesce(p ->> 'system_name', ''))) < 1 then
    perform private.raise_app_error('VALIDATION', 'system_name');
  end if;
  if length(trim(coalesce(p ->> 'location', ''))) < 2 then
    perform private.raise_app_error('VALIDATION', 'location');
  end if;
  if v_district is not null and not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  if exists (select 1 from public.printers x where x.serial_no = v_serial and x.id is distinct from v_id) then
    perform private.raise_app_error('VALIDATION', 'serial_taken');
  end if;
  if v_mac is not null and exists (select 1 from public.printers x where x.mac_address = v_mac and x.id is distinct from v_id) then
    perform private.raise_app_error('VALIDATION', 'mac_taken');
  end if;
  if v_ip is not null and exists (select 1 from public.printers x where x.ip_address = v_ip and x.id is distinct from v_id) then
    perform private.raise_app_error('VALIDATION', 'ip_taken');
  end if;

  if v_id is null then
    insert into public.printers (code, name, manufacturer, model, serial_no, mac_address, ip_address, connection_type, system_name, location, department, district_id, created_by)
    values ('PRN-' || lpad(private.next_serial('PRN')::text, 4, '0'), trim(p ->> 'name'), trim(p ->> 'manufacturer'), trim(p ->> 'model'), v_serial, v_mac, v_ip, v_conn,
            trim(p ->> 'system_name'), trim(p ->> 'location'), nullif(trim(coalesce(p ->> 'department', '')), ''), v_district, auth.uid())
    returning id into v_id;
  else
    update public.printers
       set name = trim(p ->> 'name'), manufacturer = trim(p ->> 'manufacturer'), model = trim(p ->> 'model'), serial_no = v_serial, mac_address = v_mac, ip_address = v_ip,
           connection_type = v_conn, system_name = trim(p ->> 'system_name'), location = trim(p ->> 'location'),
           department = nullif(trim(coalesce(p ->> 'department', '')), ''), district_id = v_district, updated_at = now()
     where id = v_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'printer');
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.printer_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.printers');
  update public.printers set active = p_active, updated_at = now() where id = p_id;
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'printer');
  end if;
  -- Jobs waiting for a printer that was switched off need sending again.
  if not p_active then
    update public.printer_queue set status = 'failed', finished_at = now(), error = 'printer_deactivated', token_hash = null
     where printer_id = p_id and status = 'queued';
  end if;
end;
$$;

/** A new secret key for the print program of the printer; the old one stops working. Shown only this once. */
create or replace function public.printer_new_key(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'lrmis_pa_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform private.assert_permission('certificates.printers');
  if not exists (select 1 from public.printers where id = p_id) then
    perform private.raise_app_error('NOT_FOUND', 'printer');
  end if;
  insert into public.printer_keys (printer_id, key_hash) values (p_id, private.printer_key_hash(v_key))
  on conflict (printer_id) do update set key_hash = excluded.key_hash, created_at = now();
  perform private.audit('printer.new_key', 'printers', p_id::text, null, null);
  return v_key;
end;
$$;

create or replace function public.printer_resolve_alert(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.printers');
  update public.printer_alerts set resolved_at = now(), resolved_by = auth.uid() where id = p_id and resolved_at is null;
end;
$$;

/** Everything on the Add printer page. */
create or replace function public.printer_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.printers');
  return jsonb_build_object(
    'printers', coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from (
        select p.id, p.code, p.name, p.manufacturer, p.model, p.serial_no, p.mac_address, p.ip_address, p.connection_type, p.system_name, p.location, p.department,
               p.district_id, p.active, p.agent_last_seen, p.agent_ip, exists (select 1 from public.printer_keys k where k.printer_id = p.id) as has_key
          from public.printers p) x), '[]'::jsonb),
    'documents_printed', (select count(*) from public.issued_documents where print_count > 0),
    'pending', (select count(*) from public.printer_queue where status in ('queued', 'printing')),
    'failed', (select count(*) from public.printer_queue where status = 'failed' and requested_at > now() - interval '7 days'),
    'alerts', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
        select a.id, a.kind, a.detail, a.at, p.code as printer_code, p.name as printer_name
          from public.printer_alerts a left join public.printers p on p.id = a.printer_id
         where a.resolved_at is null order by a.at desc limit 50) x), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (
        select q.id, q.status, q.error, q.requested_at, q.finished_at, d.serial, p.code as printer_code, p.name as printer_name
          from public.printer_queue q join public.issued_documents d on d.id = q.document_id join public.printers p on p.id = q.printer_id
         order by q.requested_at desc limit 20) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Sending to a printer (print staff)
-- ---------------------------------------------------------------------------
/** The printers this person may send to: active, set up with a key, for their district or for everyone. */
create or replace function public.printer_choices()
returns table (id uuid, code text, name text, location text, online boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.print');
  return query
  select p.id, p.code, p.name, p.location, coalesce(p.agent_last_seen > now() - interval '2 minutes', false)
    from public.printers p
   where p.active and exists (select 1 from public.printer_keys k where k.printer_id = p.id)
     and (p.district_id is null or public.can_access_district(p.district_id))
   order by p.name;
end;
$$;

create or replace function public.document_send_to_printer(p_id uuid, p_printer uuid, p_locale text default 'so')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_printer public.printers;
  v_job uuid;
begin
  perform private.assert_permission('certificates.print');
  select * into v from public.issued_documents where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if v.print_count > 0 then
    perform private.raise_app_error('CONFLICT', 'already_printed');
  end if;
  if v.type = 'id_card' and (private.card_fee()).id is not null
     and not exists (select 1 from public.invoices i where i.id = v.print_fee_invoice_id and i.status = 'paid') then
    perform private.raise_app_error('CONFLICT', 'card_fee_unpaid');
  end if;
  select * into v_printer from public.printers where id = p_printer;
  if v_printer.id is null or not v_printer.active
     or not exists (select 1 from public.printer_keys k where k.printer_id = p_printer)
     or (v_printer.district_id is not null and not public.can_access_district(v_printer.district_id)) then
    perform private.raise_app_error('CONFLICT', 'printer_not_allowed');
  end if;
  if exists (select 1 from public.printer_queue q where q.document_id = p_id and q.status in ('queued', 'printing')) then
    perform private.raise_app_error('CONFLICT', 'already_queued');
  end if;
  insert into public.printer_queue (document_id, printer_id, locale, requested_by)
  values (p_id, p_printer, case when p_locale = 'en' then 'en' else 'so' end, auth.uid()) returning id into v_job;
  perform private.audit('document.send_to_printer', 'printer_queue', v_job::text, null, jsonb_build_object('document', p_id, 'serial', v.serial, 'printer', v_printer.code));
  return v_job;
end;
$$;

/** Many documents to one printer; each that cannot go is reported, the rest still go. */
create or replace function public.document_send_to_printer_bulk(p_ids uuid[], p_printer uuid, p_locale text default 'so')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_sent uuid[] := '{}';
  v_failed jsonb := '[]'::jsonb;
begin
  perform private.assert_permission('certificates.print');
  foreach v_id in array p_ids loop
    begin
      perform public.document_send_to_printer(v_id, p_printer, p_locale);
      v_sent := v_sent || v_id;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'serial', (select serial from public.issued_documents where id = v_id), 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('sent', to_jsonb(v_sent), 'failed', v_failed);
end;
$$;

/** Where documents are in the queue, for the print page to follow. */
create or replace function public.document_print_status(p_ids uuid[])
returns table (document_id uuid, status text, error text, printer_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.print');
  return query
  select distinct on (q.document_id) q.document_id, q.status, q.error, p.name
    from public.printer_queue q join public.printers p on p.id = q.printer_id
         join public.issued_documents d on d.id = q.document_id
   where q.document_id = any (p_ids) and public.can_access_district(d.district_id)
   order by q.document_id, q.requested_at desc;
end;
$$;

-- The browser path is closed: official copies only come out of an added printer.
create or replace function public.document_print(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.print');
  perform private.raise_app_error('CONFLICT', 'use_printer');
end;
$$;

create or replace function public.document_print_bulk(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_permission('certificates.print');
  perform private.raise_app_error('CONFLICT', 'use_printer');
end;
$$;

-- ---------------------------------------------------------------------------
-- The print program (signs in with the printer's key, not as a person)
-- ---------------------------------------------------------------------------
/**
 * The program checks in and takes the next job. p_info: printers (names on this computer), printer_mac (what the
 * network says is at the address of the printer). A bad key is answered, not raised, so its alert is kept.
 */
create or replace function public.agent_claim_job(p_key text, p_ip text, p_info jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer public.printers;
  v_job public.printer_queue;
  v_doc public.issued_documents;
  v_token text;
  v_seen text := nullif(upper(replace(coalesce(p_info ->> 'printer_mac', ''), '-', ':')), '');
  v_blocked text;
begin
  select p.* into v_printer from public.printer_keys k join public.printers p on p.id = k.printer_id
   where k.key_hash = private.printer_key_hash(p_key) for update of p;
  if v_printer.id is null then
    perform private.printer_alert(null, 'bad_key', jsonb_build_object('ip', p_ip));
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;

  update public.printers set agent_last_seen = now(), agent_ip = coalesce(p_ip, agent_ip) where id = v_printer.id;
  if v_printer.agent_ip is not null and p_ip is not null and v_printer.agent_ip <> p_ip then
    perform private.printer_alert(v_printer.id, 'agent_moved', jsonb_build_object('from', v_printer.agent_ip, 'to', p_ip));
  end if;

  -- A job that never reported back: not retried by itself, it may already be on paper.
  update public.printer_queue set status = 'failed', finished_at = now(), error = 'no_report', token_hash = null
   where printer_id = v_printer.id and status = 'printing' and claimed_at < now() - interval '15 minutes';

  if not v_printer.active then
    perform private.printer_alert(v_printer.id, 'inactive_printer_used', jsonb_build_object('ip', p_ip));
    v_blocked := 'inactive';
  elsif jsonb_typeof(p_info -> 'printers') = 'array' and not (p_info -> 'printers') ? v_printer.system_name then
    perform private.printer_alert(v_printer.id, 'printer_missing', jsonb_build_object('name', v_printer.system_name, 'ip', p_ip));
    v_blocked := 'printer_missing';
  elsif v_seen is not null and v_printer.mac_address is not null and v_seen <> v_printer.mac_address then
    perform private.printer_alert(v_printer.id, 'network_changed', jsonb_build_object('expected', v_printer.mac_address, 'seen', v_seen, 'address', v_printer.ip_address));
    v_blocked := 'network_changed';
  end if;

  if v_blocked is null then
    select * into v_job from public.printer_queue
     where printer_id = v_printer.id and status = 'queued' order by requested_at for update skip locked limit 1;
    if v_job.id is not null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      update public.printer_queue set status = 'printing', claimed_at = now(), token_hash = private.printer_key_hash(v_token) where id = v_job.id;
      select * into v_doc from public.issued_documents where id = v_job.document_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'blocked', v_blocked,
    'printer', jsonb_build_object('code', v_printer.code, 'system_name', v_printer.system_name, 'ip_address', v_printer.ip_address, 'connection_type', v_printer.connection_type),
    'job', case when v_token is not null then jsonb_build_object('id', v_job.id, 'token', v_token, 'type', v_doc.type, 'serial', v_doc.serial, 'locale', v_job.locale) end);
end;
$$;

/** The program reports what happened. Only a job on its own printer, and only once. */
create or replace function public.agent_report_job(p_key text, p_job uuid, p_ok boolean, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer uuid;
  v_job public.printer_queue;
begin
  select k.printer_id into v_printer from public.printer_keys k where k.key_hash = private.printer_key_hash(p_key);
  if v_printer is null then
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;
  select * into v_job from public.printer_queue where id = p_job and printer_id = v_printer and status = 'printing' for update;
  if v_job.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  update public.printer_queue
     set status = case when p_ok then 'printed' else 'failed' end, finished_at = now(), token_hash = null,
         error = case when p_ok then null else left(coalesce(nullif(trim(p_error), ''), 'print_failed'), 300) end
   where id = p_job;
  if p_ok then
    perform private.document_record_print(v_job.document_id, v_job.requested_by);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

/** The document behind a job being printed, for the page the program opens. The one-time token is the only way in. */
create or replace function public.agent_job_document(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.printer_queue;
  v public.issued_documents;
begin
  select * into v_job from public.printer_queue
   where token_hash = private.printer_key_hash(p_token) and status = 'printing' and claimed_at > now() - interval '15 minutes';
  if v_job.id is null then
    return null;
  end if;
  select * into v from public.issued_documents where id = v_job.document_id;
  return jsonb_build_object(
    'doc', to_jsonb(v) || jsonb_build_object(
      'parcel', (select jsonb_build_object('id', p.id, 'pun', p.pun) from public.parcels p where p.id = v.parcel_id),
      'party', (select jsonb_build_object('full_name', pa.full_name) from public.parties pa where pa.id = v.party_id)),
    'facts', jsonb_build_object(
      'house_no', (select house_no from public.parcels where id = v.parcel_id),
      'invoice_no', (select i.number from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                      where i.parcel_id = v.parcel_id and i.status <> 'cancelled'
                      order by (ft.code = 'property_bill') desc, i.issue_date, i.number limit 1),
      'phones', coalesce((select jsonb_object_agg(pa.id, pa.phone) from public.parties pa
                           where pa.id in (select (o ->> 'party_id')::uuid from jsonb_array_elements(coalesce(v.snapshot -> 'owners', '[]')) o)
                             and pa.phone is not null), '{}'::jsonb)),
    'photo_path', (select pa.photo_path from public.parties pa where pa.id = (v.snapshot -> 'holder' ->> 'party_id')::uuid),
    'outlines', case when v.type = 'id_card' then (select jsonb_agg(to_jsonb(o)) from public.banadir_map_outlines() o) end);
end;
$$;

revoke all on function private.printer_alert(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.document_record_print(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agent_claim_job(text, text, jsonb) from public;
revoke all on function public.agent_report_job(text, uuid, boolean, text) from public;
revoke all on function public.agent_job_document(text) from public;
grant execute on function public.agent_claim_job(text, text, jsonb) to anon;
grant execute on function public.agent_report_job(text, uuid, boolean, text) to anon;
grant execute on function public.agent_job_document(text) to anon;
grant execute on function public.printer_save(jsonb) to authenticated;
grant execute on function public.printer_set_active(uuid, boolean) to authenticated;
grant execute on function public.printer_new_key(uuid) to authenticated;
grant execute on function public.printer_resolve_alert(uuid) to authenticated;
grant execute on function public.printer_overview() to authenticated;
grant execute on function public.printer_choices() to authenticated;
grant execute on function public.document_send_to_printer(uuid, uuid, text) to authenticated;
grant execute on function public.document_send_to_printer_bulk(uuid[], uuid, text) to authenticated;
grant execute on function public.document_print_status(uuid[]) to authenticated;
