-- Print without opening a page: a Print key sends the certificate or invoice straight to the added printer at the
-- person's own point of sale (or, failing that, one in the right district). Invoices now go through the print queue too.

-- 1. The queue holds a document or an invoice (one of the two).
alter table public.printer_queue alter column document_id drop not null;
alter table public.printer_queue add column if not exists invoice_id uuid references public.invoices(id);
alter table public.printer_queue drop constraint if exists printer_queue_one_thing;
alter table public.printer_queue add constraint printer_queue_one_thing check (num_nonnulls(document_id, invoice_id) = 1);
create unique index if not exists printer_queue_one_open_invoice on public.printer_queue (invoice_id)
  where status in ('queued', 'printing') and invoice_id is not null;

-- 2. Print now (certificates and ID cards): the printer at this person's own point of sale first, then one that is on.
do $$
declare
  d text := pg_get_functiondef('public.document_print_now(uuid,text)'::regprocedure);
  a text := 'order by coalesce(p.agent_last_seen > now() - interval ''2 minutes'', false) desc,
            (v_my_pos is not null and p.pos_id = v_my_pos) desc,';
  b text := 'order by coalesce(p.pos_id = v_my_pos, false) desc,
            coalesce(p.agent_last_seen > now() - interval ''2 minutes'', false) desc,';
begin
  if position(a in d) = 0 then
    raise exception 'document_print_now: order not found';
  end if;
  execute replace(d, a, b);
end $$;

-- The printer list: this person's own desk first (a printer with no point of sale is not "mine").
do $$
declare
  d text := pg_get_functiondef('public.printer_choices(uuid)'::regprocedure);
begin
  if position('order by (v_my_pos is not null and p.pos_id = v_my_pos) desc' in d) = 0 then
    raise exception 'printer_choices: order not found';
  end if;
  d := replace(d, 'order by (v_my_pos is not null and p.pos_id = v_my_pos) desc', 'order by coalesce(p.pos_id = v_my_pos, false) desc');
  d := replace(d, 's.name, (v_my_pos is not null and p.pos_id = v_my_pos)', 's.name, coalesce(p.pos_id = v_my_pos, false)');
  execute d;
end $$;

-- 3. Print an invoice now.
create or replace function public.invoice_print_now(p_id uuid, p_locale text default 'so')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_my_pos uuid := (select pr.point_of_sale_id from public.profiles pr where pr.user_id = auth.uid());
  v_printer public.printers;
  v_job uuid;
begin
  perform private.assert_permission('invoices.print');
  select * into v from public.invoices where id = p_id;
  if v.id is null or not private.can_view_invoice_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  if v.status = 'cancelled' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  -- The printer at this person's own point of sale; otherwise one in the invoice's district, one that is on first.
  select p.* into v_printer from public.printers p
   where p.active
     and exists (select 1 from public.printer_keys k where k.printer_id = p.id)
     and ((v_my_pos is not null and p.pos_id = v_my_pos) or p.district_id = v.district_id)
     and (p.district_id is null or public.can_access_district(p.district_id))
   order by coalesce(p.pos_id = v_my_pos, false) desc,
            coalesce(p.agent_last_seen > now() - interval '2 minutes', false) desc,
            p.name
   limit 1;
  if v_printer.id is null then
    perform private.raise_app_error('CONFLICT', 'no_desk_printer');
  end if;
  if exists (select 1 from public.printer_queue q where q.invoice_id = p_id and q.status in ('queued', 'printing')) then
    perform private.raise_app_error('CONFLICT', 'already_queued');
  end if;
  insert into public.printer_queue (invoice_id, printer_id, locale, requested_by)
  values (p_id, v_printer.id, case when p_locale = 'en' then 'en' else 'so' end, auth.uid()) returning id into v_job;
  perform private.audit('invoice.send_to_printer', 'printer_queue', v_job::text, null, jsonb_build_object('invoice', v.number, 'printer', v_printer.code));
  return jsonb_build_object('job', v_job, 'printer', v_printer.name,
    'online', coalesce(v_printer.agent_last_seen > now() - interval '2 minutes', false));
end;
$$;
revoke all on function public.invoice_print_now(uuid, text) from public, anon;
grant execute on function public.invoice_print_now(uuid, text) to authenticated;

-- 4. The print program: an invoice job is named by its number.
do $$
declare
  d text := pg_get_functiondef('public.agent_claim_job(text,text,jsonb)'::regprocedure);
  a text := '''type'', v_doc.type, ''serial'', v_doc.serial,';
  b text := '''type'', coalesce(v_doc.type::text, ''invoice''), ''serial'', coalesce(v_doc.serial, (select i.number from public.invoices i where i.id = v_job.invoice_id)),';
begin
  if position(a in d) = 0 then
    raise exception 'agent_claim_job: return not found';
  end if;
  execute replace(d, a, b);
end $$;

-- An invoice printed is not a document print.
do $$
declare
  d text := pg_get_functiondef('public.agent_report_job(text,uuid,boolean,text)'::regprocedure);
  a text := 'if p_ok then
    perform private.document_record_print';
  b text := 'if p_ok and v_job.document_id is not null then
    perform private.document_record_print';
begin
  if position(a in d) = 0 then
    raise exception 'agent_report_job: record not found';
  end if;
  execute replace(d, a, b);
end $$;

-- The Printers page lists invoice jobs by their number.
do $$
declare
  d text := pg_get_functiondef('public.printer_overview()'::regprocedure);
  a text := 'select q.id, q.status, q.error, q.requested_at, q.finished_at, d.serial, p.code as printer_code, p.name as printer_name
          from public.printer_queue q join public.issued_documents d on d.id = q.document_id join public.printers p on p.id = q.printer_id';
  b text := 'select q.id, q.status, q.error, q.requested_at, q.finished_at, coalesce(d.serial, i.number) as serial, p.code as printer_code, p.name as printer_name
          from public.printer_queue q left join public.issued_documents d on d.id = q.document_id
               left join public.invoices i on i.id = q.invoice_id join public.printers p on p.id = q.printer_id';
begin
  if position(a in d) = 0 then
    raise exception 'printer_overview: jobs not found';
  end if;
  execute replace(d, a, b);
end $$;

-- 5. What the print program's page shows: the document, or the invoice.
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
  i public.invoices;
begin
  select * into v_job from public.printer_queue
   where token_hash = private.printer_key_hash(p_token) and status = 'printing' and claimed_at > now() - interval '15 minutes';
  if v_job.id is null then
    return null;
  end if;
  if v_job.invoice_id is not null then
    select * into i from public.invoices where id = v_job.invoice_id;
    return jsonb_build_object('invoice', jsonb_build_object(
      'number', i.number, 'period', i.period, 'issue_date', i.issue_date, 'due_date', i.due_date,
      'total', i.total, 'paid', i.paid, 'credited', i.credited, 'balance', i.balance,
      'discount_until', i.discount_until, 'early_discount_pct', i.early_discount_pct,
      'fee_type', (select jsonb_build_object('name_so', f.name_so, 'name_en', f.name_en) from public.fee_types f where f.id = i.fee_type_id),
      'parcel', (select jsonb_build_object('pun', p.pun, 'account_no', p.account_no,
                   'neighbourhood', (select jsonb_build_object('name_so', n.name_so, 'name_en', n.name_en) from public.neighbourhoods n where n.id = p.neighbourhood_id),
                   'district', (select jsonb_build_object('name_so', d.name_so, 'name_en', d.name_en) from public.districts d where d.id = p.district_id))
                 from public.parcels p where p.id = i.parcel_id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'description', l.description, 'amount', l.amount) order by l.created_at)
                 from public.invoice_lines l where l.invoice_id = i.id), '[]'::jsonb),
      'owners', coalesce((select jsonb_agg(jsonb_build_object('share_pct', po.share_pct, 'full_name', pa.full_name) order by (po.role = 'owner') desc, po.created_at)
                 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                where po.parcel_id = i.parcel_id and po.valid_to is null), '[]'::jsonb),
      'pay_link', (select '/pay/' || t.token from public.invoice_tokens t where t.invoice_id = i.id limit 1)));
  end if;
  select * into v from public.issued_documents where id = v_job.document_id;
  return jsonb_build_object(
    'doc', to_jsonb(v) || jsonb_build_object(
      'parcel', (select jsonb_build_object('id', p.id, 'pun', p.pun) from public.parcels p where p.id = v.parcel_id),
      'party', (select jsonb_build_object('full_name', pa.full_name) from public.parties pa where pa.id = v.party_id)),
    'facts', jsonb_build_object(
      'house_no', (select house_no from public.parcels where id = v.parcel_id),
      'invoice_no', (select i2.number from public.invoices i2 join public.fee_types ft on ft.id = i2.fee_type_id
                      where i2.parcel_id = v.parcel_id and i2.status <> 'cancelled'
                      order by (ft.code = 'property_bill') desc, i2.issue_date, i2.number limit 1),
      'phones', coalesce((select jsonb_object_agg(pa.id, pa.phone) from public.parties pa
                           where pa.id in (select (o ->> 'party_id')::uuid from jsonb_array_elements(coalesce(v.snapshot -> 'owners', '[]')) o)
                             and pa.phone is not null), '{}'::jsonb)),
    'photo_path', (select pa.photo_path from public.parties pa where pa.id = (v.snapshot -> 'holder' ->> 'party_id')::uuid),
    'outlines', case when v.type = 'id_card' then (select jsonb_agg(jsonb_build_object('code', d.code, 'name_so', d.name_so, 'name_en', d.name_en,
                         'outline', extensions.st_asgeojson(extensions.st_simplifypreservetopology(d.geom, 0.0004), 5)::jsonb) order by d.code)
                       from public.districts d where d.deleted_at is null and d.geom is not null) end);
end;
$$;
