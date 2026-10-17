-- ============================================================================
-- 0029 Audit fix: a webhook with a bad signature was stored first and took the
-- (provider, event_id) slot, so the genuine event with the same id was dropped as a
-- duplicate and the payment never credited. Only correctly signed events claim the id now.
-- ============================================================================

alter table public.provider_webhook_events drop constraint provider_webhook_events_provider_event_id_key;
create unique index provider_webhook_events_signed_uidx on public.provider_webhook_events (provider, event_id) where signature_ok;

create or replace function public.webhook_ingest(p_provider text, p_event_id text, p_signature_ok boolean, p_event jsonb, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev bigint;
  v_intent public.payment_intents;
  v_inv public.invoices;
  v_parcel uuid;
  v_res jsonb;
  v_result text;
  v_method public.payment_method;
begin
  -- Forged events are kept for audit but never claim the event id, so they can't block the real one.
  if not p_signature_ok then
    insert into public.provider_webhook_events (provider, event_id, raw, signature_ok, processed_at, result)
    values (p_provider, p_event_id, coalesce(p_raw, '{}'::jsonb), false, now(), 'bad_signature');
    return jsonb_build_object('result', 'bad_signature');
  end if;
  insert into public.provider_webhook_events (provider, event_id, raw, signature_ok)
  values (p_provider, p_event_id, coalesce(p_raw, '{}'::jsonb), true)
  on conflict (provider, event_id) where signature_ok do nothing
  returning id into v_ev;
  if v_ev is null then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select method into v_method from public.payment_providers where code = p_provider;

  select * into v_intent from public.payment_intents
  where id = nullif(p_event ->> 'intent_id', '')::uuid or (provider_ref is not null and provider_ref = p_event ->> 'provider_ref')
  limit 1 for update;

  if p_event ->> 'status' <> 'succeeded' then
    if v_intent.id is not null and v_intent.status = 'pending' then
      update public.payment_intents set status = 'failed', failure_reason = left(coalesce(p_event ->> 'failure_reason', 'failed'), 200), completed_at = now()
       where id = v_intent.id;
    end if;
    update public.provider_webhook_events set processed_at = now(), result = 'failed' where id = v_ev;
    return jsonb_build_object('result', 'failed');
  end if;

  if exists (select 1 from public.payments where provider_ref = coalesce(p_event ->> 'provider_ref', p_event_id)) then
    update public.provider_webhook_events set processed_at = now(), result = 'already_recorded' where id = v_ev;
    return jsonb_build_object('result', 'already_recorded');
  end if;

  if v_intent.id is not null then
    select * into v_inv from public.invoices where id = v_intent.invoice_id;
    v_parcel := v_inv.parcel_id;
    v_result := 'recorded';
  else
    -- Merchant-number / USSD payments carry the PUN as the reference.
    select id into v_parcel from public.parcels where pun = upper(trim(p_event ->> 'reference')) and deleted_at is null;
    v_result := case when v_parcel is null then 'unmatched' else 'recorded_by_reference' end;
  end if;

  v_res := private.record_payment(jsonb_build_object(
    'parcel_id', v_parcel, 'invoice_id', v_inv.id, 'method', coalesce(v_method, 'mobile_money'), 'provider', p_provider,
    'provider_ref', coalesce(p_event ->> 'provider_ref', p_event_id), 'reference', p_event ->> 'reference',
    'currency', coalesce(p_event ->> 'currency', 'USD'), 'amount', (p_event ->> 'amount')::numeric,
    'intent_id', v_intent.id, 'payer_phone', p_event ->> 'phone'));
  if v_intent.id is not null then
    update public.payment_intents set status = 'succeeded', completed_at = now() where id = v_intent.id;
  end if;
  update public.provider_webhook_events set processed_at = now(), result = v_result, payment_id = (v_res ->> 'payment_id')::uuid where id = v_ev;
  return jsonb_build_object('result', v_result) || v_res;
end;
$$;
