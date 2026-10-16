-- ============================================================================
-- 0023 Phase 11: citizen portal overview, USSD and WhatsApp self-service.
-- Channel functions are for the service role only (called by the USSD / WhatsApp webhooks)
-- and answer only about parcels and applications linked to the caller's own phone number.
-- ============================================================================

insert into public.settings (key, value, is_public, description) values
  ('site.public_url', '"https://lrmis.so"', true, 'Public address used in SMS links (pay, track, verify)'),
  ('channels.hourly_limit', '30', false, 'Most USSD / WhatsApp requests one phone may make per hour')
on conflict (key) do nothing;

insert into public.message_templates (code, is_system, description, body_so, body_en) values
  ('pay_link', true, 'Payer asked for a payment link (USSD / WhatsApp)',
   'LRMIS: Biilka {invoice} (${amount}). Ku bixi halkan: {link}',
   'LRMIS: Invoice {invoice} (${amount}). Pay here: {link}'),
  ('channel_reply', true, 'Reply to a WhatsApp question',
   '{text}',
   '{text}')
on conflict (code) do nothing;

create or replace function private.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.settings where key = p_key), p_default);
$$;
revoke execute on function private.setting_text(text, text) from public, anon, authenticated;

-- Inbound requests: kept for rate limiting and support, without the full text of USSD paths.
create table public.channel_requests (
  id          bigint generated always as identity primary key,
  channel     text not null check (channel in ('ussd', 'whatsapp')),
  phone       text not null,
  command     text not null check (length(command) <= 40),
  ok          boolean not null default true,
  created_at  timestamptz not null default now()
);
create index channel_requests_phone_idx on public.channel_requests (phone, created_at desc);
alter table public.channel_requests enable row level security;
create policy channel_requests_select on public.channel_requests for select to authenticated
  using (public.has_permission('messages.view'));

-- ---------------------------------------------------------------------------
-- Citizen portal: everything linked to the signed-in person in one call.
-- ---------------------------------------------------------------------------
create or replace function public.citizen_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id from public.parties p where p.citizen_user_id = auth.uid()
  ), my_parcels as (
    select distinct pc.* from public.parcels pc
      join public.parcel_owners po on po.parcel_id = pc.id and po.valid_to is null
     where po.party_id in (select id from me) and pc.deleted_at is null
  )
  select jsonb_build_object(
    'parcels', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pc.id, 'pun', pc.pun, 'status', pc.status, 'land_use', pc.land_use, 'area_m2', pc.area_m2,
        'district', (select jsonb_build_object('name_so', d.name_so, 'name_en', d.name_en) from public.districts d where d.id = pc.district_id),
        'neighbourhood', (select jsonb_build_object('name_so', n.name_so, 'name_en', n.name_en) from public.neighbourhoods n where n.id = pc.neighbourhood_id),
        'share', (select max(po.share_pct) from public.parcel_owners po where po.parcel_id = pc.id and po.valid_to is null and po.party_id in (select id from me)),
        'balance', (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = pc.id and i.status in ('issued', 'partially_paid')),
        'overdue', (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = pc.id and i.status in ('issued', 'partially_paid') and i.due_date < current_date),
        'invoices', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'number', i.number, 'period', i.period, 'due_date', i.due_date, 'total', i.total, 'balance', i.balance, 'status', i.status,
            'fee_so', ft.name_so, 'fee_en', ft.name_en, 'token', tk.token) order by i.due_date desc)
          from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
          left join public.invoice_tokens tk on tk.invoice_id = i.id
          where i.parcel_id = pc.id and i.status <> 'cancelled' and (i.balance > 0 or i.issue_date > current_date - 400)), '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(jsonb_build_object(
            'id', d.id, 'type', d.type, 'serial', d.serial, 'status', d.status, 'verify_code', d.verify_code, 'issued_at', d.issued_at, 'expires_at', d.expires_at)
            order by d.issued_at desc)
          from public.issued_documents d where d.parcel_id = pc.id and d.status = 'valid'), '[]'::jsonb),
        'geom', extensions.st_asgeojson(pc.geom)::jsonb
      ) order by pc.pun) from my_parcels pc), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'status', m.status, 'created_at', m.created_at) order by m.created_at desc)
        from (select * from public.messages m where m.party_id in (select id from me) order by created_at desc limit 20) m), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'amount', p.amount_base, 'received_at', p.received_at, 'pun', pc.pun, 'method', p.method)
          order by p.received_at desc)
        from (select p.* from public.payments p where p.status = 'completed' and p.parcel_id in (select id from my_parcels) order by received_at desc limit 20) p
        join my_parcels pc on pc.id = p.parcel_id), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Channel primitives (service role). Phone numbers are E.164 (+2526…).
-- ---------------------------------------------------------------------------
create or replace function private.channel_parties(p_phone text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.parties where phone = p_phone and deleted_at is null;
$$;

/** Log the request and say whether this phone is still under its hourly limit. */
create or replace function public.channel_hit(p_channel text, p_phone text, p_command text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  select count(*) into v_n from public.channel_requests where phone = p_phone and created_at > now() - interval '1 hour';
  insert into public.channel_requests (channel, phone, command, ok)
  values (p_channel, p_phone, left(coalesce(p_command, ''), 40), v_n < private.setting_int('channels.hourly_limit', 30));
  return v_n < private.setting_int('channels.hourly_limit', 30);
end;
$$;

/** Parcels owned by people with this phone, with what they owe. */
create or replace function public.channel_balance(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'pun', pc.pun,
      'balance', (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = pc.id and i.status in ('issued', 'partially_paid')),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.number, 'balance', i.balance, 'due_date', i.due_date) order by i.due_date)
                    from public.invoices i where i.parcel_id = pc.id and i.status in ('issued', 'partially_paid') and i.balance > 0), '[]'::jsonb))
      order by pc.pun), '[]'::jsonb)
    from (select distinct pc.id, pc.pun from public.parcels pc
            join public.parcel_owners po on po.parcel_id = pc.id and po.valid_to is null
           where po.party_id in (select private.channel_parties(p_phone)) and pc.deleted_at is null and pc.pun is not null) pc;
$$;

/** An application's status, only when this phone belongs to its applicant or one of its owners. */
create or replace function public.channel_track(p_phone text, p_number text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('number', a.number, 'status', a.status, 'updated_at', a.updated_at)
    from public.applications a
   where a.number = upper(trim(p_number))
     and (a.applicant_party_id in (select private.channel_parties(p_phone))
          or exists (select 1 from public.application_parties ap where ap.application_id = a.id and ap.party_id in (select private.channel_parties(p_phone))));
$$;

/** Text a pay link for one of the caller's own open invoices. Returns the invoice number, or null. */
create or replace function public.channel_send_pay_link(p_phone text, p_invoice text, p_lang text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_url text := coalesce(nullif(private.setting_text('site.public_url', ''), ''), 'https://lrmis.so');
begin
  select i.id, i.number, i.balance, i.district_id, tk.token, po.party_id into v
    from public.invoices i
    join public.parcel_owners po on po.parcel_id = i.parcel_id and po.valid_to is null
    left join public.invoice_tokens tk on tk.invoice_id = i.id
   where i.number = upper(trim(p_invoice)) and i.status in ('issued', 'partially_paid') and i.balance > 0
     and po.party_id in (select private.channel_parties(p_phone))
   limit 1;
  if v.id is null then
    return null;
  end if;
  if v.token is null then
    insert into public.invoice_tokens (invoice_id) values (v.id) on conflict do nothing;
    select token into v.token from public.invoice_tokens where invoice_id = v.id;
  end if;
  perform private.queue_message('pay_link', p_phone, v.party_id, case when p_lang = 'en' then 'en' else 'so' end,
    jsonb_build_object('invoice', v.number, 'amount', to_char(v.balance, 'FM999999990.00'), 'link', rtrim(v_url, '/') || '/pay/' || v.token),
    v.district_id, 'invoice', v.id, 'paylink:' || v.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
  return jsonb_build_object('number', v.number, 'balance', v.balance);
end;
$$;

/** Queue a WhatsApp reply (sent by the dispatcher through the WhatsApp provider). */
create or replace function public.channel_reply_whatsapp(p_phone text, p_text text, p_lang text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_party uuid := (select private.channel_parties(p_phone) limit 1);
begin
  insert into public.messages (channel, to_address, party_id, lang, template_code, body, related_kind)
  values ('whatsapp', p_phone, v_party, case when p_lang = 'en' then 'en' else 'so' end, 'channel_reply', left(p_text, 1000), 'whatsapp')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.channel_preferred_lang(p_phone text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.party_lang(id) from private.channel_parties(p_phone) id limit 1), 'so');
$$;

grant execute on function public.citizen_overview() to authenticated;
revoke execute on function public.citizen_overview() from public, anon;
revoke execute on function public.channel_hit(text, text, text), public.channel_balance(text), public.channel_track(text, text),
  public.channel_send_pay_link(text, text, text), public.channel_reply_whatsapp(text, text, text), public.channel_preferred_lang(text),
  private.channel_parties(text)
from public, anon, authenticated;
grant execute on function public.channel_hit(text, text, text), public.channel_balance(text), public.channel_track(text, text),
  public.channel_send_pay_link(text, text, text), public.channel_reply_whatsapp(text, text, text), public.channel_preferred_lang(text)
to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prune-channel-requests', '45 3 * * *', $c$delete from public.channel_requests where created_at < now() - interval '90 days'$c$);
  end if;
end $$;
