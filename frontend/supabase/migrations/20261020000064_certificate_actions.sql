-- Certificate actions:
--   * Correct and reissue: after owner or parcel details are fixed in the register, ask for a new
--     document from today's register. No fee; another officer approves. A corrected title
--     certificate also brings the owners' ID cards in line (new owners get one, former owners'
--     cards are cancelled).
--   * One-step reprint: a super admin reprints at once (no second person, no fee). The reason and
--     who did it are still recorded as an approved request.
--   * Bulk issue (certificates.approve) and bulk print logging (certificates.print).
--   * document_changes: what differs between a document and today's register.

alter table public.reprint_requests
  add column if not exists kind text not null default 'reprint' check (kind in ('reprint', 'correction'));

/** Cancel a document and issue its replacement; for a corrected certificate, also sync the owners' ID cards. */
create or replace function private.replace_document(p_doc uuid, p_kind text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_new uuid;
  r record;
begin
  select * into v from public.issued_documents where id = p_doc for update;
  if v.type = 'id_card' and p_kind = 'correction'
     and not exists (select 1 from public.parcel_owners where parcel_id = v.parcel_id and party_id = v.party_id and valid_to is null) then
    perform private.raise_app_error('CONFLICT', 'not_owner');
  end if;
  update public.issued_documents
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = case when p_kind = 'correction' then 'Corrected: ' else 'Reprinted: ' end || p_reason
   where id = v.id;
  v_new := private.issue_document(v.type, v.parcel_id, v.party_id, v.id);
  if p_kind = 'correction' and v.type = 'certificate' then
    update public.issued_documents d
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'No longer an owner'
     where d.parcel_id = v.parcel_id and d.type = 'id_card' and d.status = 'valid'
       and not exists (select 1 from public.parcel_owners po where po.parcel_id = v.parcel_id and po.party_id = d.party_id and po.valid_to is null);
    for r in select po.party_id from public.parcel_owners po where po.parcel_id = v.parcel_id and po.valid_to is null
             and not exists (select 1 from public.issued_documents d where d.parcel_id = v.parcel_id and d.party_id = po.party_id and d.type = 'id_card' and d.status = 'valid') loop
      perform private.issue_document('id_card', v.parcel_id, r.party_id, null);
    end loop;
  end if;
  return v_new;
end;
$$;

/** Ask for a corrected document after the register was fixed: no fee, another officer approves. */
create or replace function public.reissue_request(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_req uuid;
begin
  perform private.assert_permission('certificates.reprint');
  select * into v from public.issued_documents where id = p_id;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if exists (select 1 from public.reprint_requests where document_id = p_id and status = 'pending') then
    perform private.raise_app_error('CONFLICT', 'reprint_pending');
  end if;
  insert into public.reprint_requests (document_id, reason, kind, requested_by) values (p_id, trim(p_reason), 'correction', auth.uid())
  returning id into v_req;
  perform private.parcel_event(v.parcel_id, 'reissue_requested', p_reason, jsonb_build_object('document_id', p_id));
  return jsonb_build_object('request_id', v_req);
end;
$$;

/** Approve (someone else; a reprint's fee paid) → new document, old one cancelled. Reject needs a note. */
create or replace function public.reprint_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.reprint_requests;
  v_doc public.issued_documents;
  v_new uuid;
  v_parcel public.parcels;
begin
  perform private.assert_permission('certificates.approve');
  select * into v from public.reprint_requests where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'request');
  end if;
  select * into v_doc from public.issued_documents where id = v.document_id for update;
  if not public.can_access_district(v_doc.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'request');
  end if;
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  perform private.assert_maker_checker(v.requested_by);
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.reprint_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    if v.fee_invoice_id is not null then
      update public.invoices set status = 'cancelled', cancel_reason = 'Reprint rejected' where id = v.fee_invoice_id and paid = 0 and status <> 'cancelled';
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;
  if v.kind = 'correction' then
    select * into v_parcel from public.parcels where id = v_doc.parcel_id;
    if v_parcel.status <> 'registered' then
      perform private.raise_app_error('CONFLICT', 'not_registered');
    end if;
    if not exists (select 1 from public.parcel_owners where parcel_id = v_doc.parcel_id and valid_to is null) then
      perform private.raise_app_error('CONFLICT', 'no_owner');
    end if;
  elsif v.fee_invoice_id is not null and private.setting_bool('certificates.reprint_requires_fee', true)
     and exists (select 1 from public.invoices where id = v.fee_invoice_id and status <> 'paid') then
    perform private.raise_app_error('CONFLICT', 'fee_unpaid');
  end if;
  v_new := private.replace_document(v_doc.id, v.kind, v.reason);
  update public.reprint_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), new_document_id = v_new
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'document_id', v_new);
end;
$$;

/**
 * Super admin only: reprint now, without a second person or a fee. A pending request on the document
 * is completed (its unpaid fee bill cancelled); otherwise an approved request is recorded.
 */
create or replace function public.reprint_direct(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_req public.reprint_requests;
  v_new uuid;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not private.user_grants_all(auth.uid()) then
    perform private.raise_app_error('PERMISSION_DENIED', 'super_admin');
  end if;
  select * into v from public.issued_documents where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  if v.status <> 'valid' then
    perform private.raise_app_error('CONFLICT', 'cancelled');
  end if;
  select * into v_req from public.reprint_requests where document_id = p_id and status = 'pending' for update;
  if v_reason = '' and v_req.id is not null then
    v_reason := v_req.reason;
  end if;
  if length(v_reason) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  v_new := private.replace_document(p_id, coalesce(v_req.kind, 'reprint'), v_reason);
  if v_req.id is not null then
    update public.reprint_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = 'One-step (super admin): ' || v_reason, new_document_id = v_new
     where id = v_req.id;
    if v_req.fee_invoice_id is not null then
      update public.invoices set status = 'cancelled', cancel_reason = 'Reprint fee waived (one-step)' where id = v_req.fee_invoice_id and paid = 0 and status <> 'cancelled';
    end if;
  else
    insert into public.reprint_requests (document_id, reason, kind, status, requested_by, decided_by, decided_at, decision_note, new_document_id)
    values (p_id, v_reason, 'reprint', 'approved', auth.uid(), auth.uid(), now(), 'One-step (super admin)', v_new);
  end if;
  perform private.parcel_event(v.parcel_id, 'reprint_direct', v_reason, jsonb_build_object('document_id', p_id, 'new_document_id', v_new));
  return jsonb_build_object('status', 'approved', 'document_id', v_new);
end;
$$;

/** What differs between the printed document and today's register (for a correction). */
create or replace function public.document_changes(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_now jsonb;
  v_out jsonb := '[]';
  k text;
  owners_then text;
  owners_now text;
begin
  select * into v from public.issued_documents where id = p_id;
  if v.id is null or not private.can_view_document(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  v_now := private.certificate_snapshot(v.parcel_id);
  foreach k in array array['pun', 'area_m2', 'land_use', 'ownership', 'plot_no', 'deed_no'] loop
    if (v.snapshot -> k) is distinct from (v_now -> k) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('field', k, 'before', v.snapshot ->> k, 'after', v_now ->> k));
    end if;
  end loop;
  if (v.snapshot #>> '{neighbourhood,name_en}') is distinct from (v_now #>> '{neighbourhood,name_en}') then
    v_out := v_out || jsonb_build_array(jsonb_build_object('field', 'neighbourhood', 'before', v.snapshot #>> '{neighbourhood,name_en}', 'after', v_now #>> '{neighbourhood,name_en}'));
  end if;
  select string_agg((o ->> 'full_name') || coalesce(' (' || trim_scale((o ->> 'share_pct')::numeric)::text || '%)', ''), ', ' order by o ->> 'full_name')
    into owners_then from jsonb_array_elements(coalesce(v.snapshot -> 'owners', '[]')) o;
  select string_agg((o ->> 'full_name') || coalesce(' (' || trim_scale((o ->> 'share_pct')::numeric)::text || '%)', ''), ', ' order by o ->> 'full_name')
    into owners_now from jsonb_array_elements(coalesce(v_now -> 'owners', '[]')) o;
  if owners_then is distinct from owners_now then
    v_out := v_out || jsonb_build_array(jsonb_build_object('field', 'owners', 'before', owners_then, 'after', owners_now));
  end if;
  return v_out;
end;
$$;

/** Issue certificates for several parcels; each one that can't be issued is reported, the rest go ahead. */
create or replace function public.certificate_issue_bulk(p_parcels uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_issued int := 0;
  v_cards int := 0;
  v_res jsonb;
  v_failed jsonb := '[]';
begin
  perform private.assert_permission('certificates.approve');
  if coalesce(cardinality(p_parcels), 0) = 0 or cardinality(p_parcels) > 100 then
    perform private.raise_app_error('VALIDATION', 'selection');
  end if;
  foreach v_id in array p_parcels loop
    begin
      v_res := public.certificate_issue(v_id);
      v_issued := v_issued + 1;
      v_cards := v_cards + (v_res ->> 'id_cards')::int;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('parcel_id', v_id, 'pun', (select pun from public.parcels where id = v_id), 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('issued', v_issued, 'id_cards', v_cards, 'failed', v_failed);
end;
$$;

/** Log the first print of several documents at once (same rules as document_print). */
create or replace function public.document_print_bulk(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_printed jsonb := '[]';
  v_failed jsonb := '[]';
begin
  perform private.assert_permission('certificates.print');
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 100 then
    perform private.raise_app_error('VALIDATION', 'selection');
  end if;
  foreach v_id in array p_ids loop
    begin
      perform public.document_print(v_id);
      v_printed := v_printed || to_jsonb(v_id);
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', v_id, 'serial', (select serial from public.issued_documents where id = v_id), 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('printed', v_printed, 'failed', v_failed);
end;
$$;

revoke execute on function private.replace_document(uuid, text, text) from public, anon, authenticated;
grant execute on function
  public.reissue_request(uuid, text), public.reprint_decide(uuid, boolean, text), public.reprint_direct(uuid, text),
  public.document_changes(uuid), public.certificate_issue_bulk(uuid[]), public.document_print_bulk(uuid[])
to authenticated;
revoke execute on function
  public.reissue_request(uuid, text), public.reprint_decide(uuid, boolean, text), public.reprint_direct(uuid, text),
  public.document_changes(uuid), public.certificate_issue_bulk(uuid[]), public.document_print_bulk(uuid[])
from public, anon;
