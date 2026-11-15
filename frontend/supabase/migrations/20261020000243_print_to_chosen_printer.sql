-- Printing without opening another tab: the person sees the printers registered for them and chooses one; the job goes
-- to that printer's print program. Receipts can now be printed this way too (like invoices and certificates).

alter table public.printer_queue add column if not exists payment_id uuid references public.payments (id);
alter table public.printer_queue drop constraint if exists printer_queue_one_thing;
alter table public.printer_queue add constraint printer_queue_one_thing check (num_nonnulls(document_id, invoice_id, payment_id) = 1);
create index if not exists printer_queue_payment_idx on public.printer_queue (payment_id) where payment_id is not null;

-- Who may see the printers: anyone who may print something (certificates, invoices or receipts).
do $$
declare
  d text := pg_get_functiondef('public.printer_choices(uuid)'::regprocedure);
  a text := 'perform private.assert_permission(''certificates.print'');';
  b text := 'if not (public.has_permission(''certificates.print'') or public.has_permission(''invoices.print'') or public.has_permission(''payments.print'')) then
    perform private.raise_app_error(''PERMISSION_DENIED'', ''print'');
  end if;';
begin
  if position(a in d) = 0 then
    raise exception 'printer_choices: check not found';
  end if;
  execute replace(d, a, b);
end $$;

/** A printer the caller may use: active, with a print program, in their districts. */
create or replace function private.usable_printer(p_printer uuid)
returns public.printers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.printers;
begin
  select * into v from public.printers where id = p_printer;
  if v.id is null or not v.active
     or not exists (select 1 from public.printer_keys k where k.printer_id = v.id)
     or (v.district_id is not null and not public.can_access_district(v.district_id)) then
    perform private.raise_app_error('CONFLICT', 'printer_not_allowed');
  end if;
  return v;
end;
$$;
revoke all on function private.usable_printer(uuid) from public, anon, authenticated;

/** Send an invoice to the printer the person chose. */
create or replace function public.invoice_send_to_printer(p_id uuid, p_printer uuid, p_locale text default 'so')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
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
  v_printer := private.usable_printer(p_printer);
  if exists (select 1 from public.printer_queue q where q.invoice_id = p_id and q.status in ('queued', 'printing')) then
    perform private.raise_app_error('CONFLICT', 'already_queued');
  end if;
  insert into public.printer_queue (invoice_id, printer_id, locale, requested_by)
  values (p_id, v_printer.id, case when p_locale = 'en' then 'en' else 'so' end, auth.uid()) returning id into v_job;
  perform private.audit('invoice.send_to_printer', 'printer_queue', v_job::text, null, jsonb_build_object('invoice', v.number, 'printer', v_printer.code));
  return jsonb_build_object('job', v_job, 'printer', v_printer.name, 'online', coalesce(v_printer.agent_last_seen > now() - interval '2 minutes', false));
end;
$$;
revoke all on function public.invoice_send_to_printer(uuid, uuid, text) from public, anon;
grant execute on function public.invoice_send_to_printer(uuid, uuid, text) to authenticated;

/** Send a receipt to the printer the person chose. */
create or replace function public.payment_send_to_printer(p_id uuid, p_printer uuid, p_locale text default 'so')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments;
  v_printer public.printers;
  v_job uuid;
begin
  perform private.assert_permission('payments.print');
  select * into v from public.payments where id = p_id;
  if v.id is null or not private.can_view_payment(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'payment');
  end if;
  v_printer := private.usable_printer(p_printer);
  if exists (select 1 from public.printer_queue q where q.payment_id = p_id and q.status in ('queued', 'printing')) then
    perform private.raise_app_error('CONFLICT', 'already_queued');
  end if;
  insert into public.printer_queue (payment_id, printer_id, locale, requested_by)
  values (p_id, v_printer.id, case when p_locale = 'en' then 'en' else 'so' end, auth.uid()) returning id into v_job;
  perform private.audit('payment.send_to_printer', 'printer_queue', v_job::text, null, jsonb_build_object('receipt', v.receipt_no, 'printer', v_printer.code));
  return jsonb_build_object('job', v_job, 'printer', v_printer.name, 'online', coalesce(v_printer.agent_last_seen > now() - interval '2 minutes', false));
end;
$$;
revoke all on function public.payment_send_to_printer(uuid, uuid, text) from public, anon;
grant execute on function public.payment_send_to_printer(uuid, uuid, text) to authenticated;

-- The print program: a receipt job says it is a receipt, and its page gets the receipt's details.
do $$
declare
  c text := pg_get_functiondef('public.agent_claim_job(text,text,jsonb)'::regprocedure);
  ca text := '''type'', coalesce(v_doc.type::text, ''invoice''), ''serial'', coalesce(v_doc.serial, (select i.number from public.invoices i where i.id = v_job.invoice_id))';
  cb text := '''type'', coalesce(v_doc.type::text, case when v_job.payment_id is not null then ''receipt'' else ''invoice'' end),
      ''serial'', coalesce(v_doc.serial, (select i.number from public.invoices i where i.id = v_job.invoice_id), (select pm.receipt_no from public.payments pm where pm.id = v_job.payment_id))';
  j text := pg_get_functiondef('public.agent_job_document(text)'::regprocedure);
  ja text := '  if v_job.invoice_id is not null then';
  jb text := '  if v_job.payment_id is not null then
    return (select jsonb_build_object(''receipt'', jsonb_build_object(
      ''receipt_no'', pm.receipt_no, ''received_at'', pm.received_at, ''amount'', pm.amount, ''currency'', pm.currency,
      ''unallocated'', pm.unallocated, ''method'', pm.method, ''reference'', pm.reference, ''payer_name'', pm.payer_name, ''status'', pm.status,
      ''pos'', (select s.name from public.points_of_sale s where s.id = pm.pos_id),
      ''pun'', (select p.pun from public.parcels p where p.id = pm.parcel_id),
      ''allocations'', coalesce((select jsonb_agg(jsonb_build_object(''id'', a.id, ''number'', i2.number, ''amount'', a.amount) order by a.id)
                                 from public.payment_allocations a join public.invoices i2 on i2.id = a.invoice_id where a.payment_id = pm.id), ''[]''::jsonb)))
      from public.payments pm where pm.id = v_job.payment_id);
  end if;
' || ja;
begin
  if position(ca in c) = 0 or position(ja in j) = 0 then
    raise exception 'agent functions: anchors not found';
  end if;
  execute replace(c, ca, cb);
  execute replace(j, ja, jb);
end $$;
