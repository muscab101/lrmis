-- ============================================================================
-- 0109 Transfers: the person who started a transfer may approve it.
--
-- The second-person (maker-checker) rule is dropped for transfer approval at
-- the owner's request; transfers.approve, the duty check and the legal
-- blockers stay.
-- ============================================================================

create or replace function public.transfer_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.transfers;
  r jsonb;
  v_user uuid;
begin
  perform private.assert_permission('transfers.approve');
  select * into v from public.transfers where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'transfer');
  end if;
  if v.status <> 'submitted' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  -- The person who started the transfer may approve it too (owner's decision, 2026-10-25).
  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      perform private.raise_app_error('VALIDATION', 'note_required');
    end if;
    update public.transfers set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_id;
    update public.invoices set status = 'cancelled', cancel_reason = 'Transfer rejected' where id = v.duty_invoice_id and paid = 0 and status <> 'cancelled';
    perform private.parcel_event(v.parcel_id, 'transfer_rejected', p_note, jsonb_build_object('transfer_id', p_id));
    return;
  end if;
  if v.duty_invoice_id is not null and exists (select 1 from public.invoices where id = v.duty_invoice_id and status <> 'paid') then
    perform private.raise_app_error('CONFLICT', 'duty_unpaid');
  end if;
  perform private.assert_no_blockers(v.parcel_id, 'transfer');

  update public.parcel_owners set valid_to = current_date where parcel_id = v.parcel_id and valid_to is null;
  for r in select * from jsonb_array_elements(v.to_owners) loop
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct, source_application_id)
    values (v.parcel_id, (r ->> 'party_id')::uuid, (r ->> 'role')::public.application_party_role, (r ->> 'share_pct')::numeric, null);
  end loop;
  perform private.cancel_parcel_documents(v.parcel_id, 'Ownership transferred: ' || v.number);
  update public.transfers set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
  perform private.parcel_event(v.parcel_id, 'transferred', p_note, jsonb_build_object('transfer_id', p_id, 'from', v.from_owners, 'to', v.to_owners));
  for v_user in select distinct pa.citizen_user_id from jsonb_array_elements(v.to_owners) o join public.parties pa on pa.id = (o ->> 'party_id')::uuid
                where pa.citizen_user_id is not null loop
    perform private.notify(v_user, 'transfer.approved', 'Wareejinta ' || v.number || ' waa la ansixiyay', 'Transfer ' || v.number || ' was approved', '/portal');
  end loop;
end;
$$;

