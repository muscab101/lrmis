-- ============================================================================
-- 0033 Single SMS (old menu: SMS Management → Single SMS): an officer texts one person.
-- Goes through the outbox like everything else, so it is logged, retried and auditable.
-- ============================================================================

create or replace function public.message_send(p_phone text, p_text text, p_party uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_party public.parties;
  v_id uuid;
  v_district uuid;
begin
  perform private.assert_permission('messages.create');
  if v_phone like '0%' then v_phone := '+252' || substr(v_phone, 2);
  elsif v_phone !~ '^\+' then v_phone := '+' || v_phone; end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform private.raise_app_error('VALIDATION', 'phone');
  end if;
  if length(trim(coalesce(p_text, ''))) < 5 or length(p_text) > 600 then
    perform private.raise_app_error('VALIDATION', 'text');
  end if;
  if p_party is not null then
    select * into v_party from public.parties where id = p_party and deleted_at is null;
    v_district := v_party.district_id;
  end if;
  -- Staff limited to some districts may only text people of those districts (or the public at large).
  if v_district is not null and not public.can_access_district(v_district) then
    perform private.raise_app_error('DISTRICT_OUT_OF_SCOPE');
  end if;
  v_id := private.queue_message('general_notice', v_phone, v_party.id, coalesce(private.party_lang(v_party.id), 'so'),
    jsonb_build_object('text', trim(p_text)), v_district, 'single', null, null);
  if v_id is null then
    perform private.raise_app_error('VALIDATION', 'template');
  end if;
  return v_id;
end;
$$;
grant execute on function public.message_send(text, text, uuid) to authenticated;
revoke execute on function public.message_send(text, text, uuid) from public, anon;
