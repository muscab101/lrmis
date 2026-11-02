-- A sender can change their own message for 5 minutes after sending it. The others see that it was edited.

alter table public.chat_messages add column edited_at timestamptz;

create or replace function public.chat_edit_message(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.chat_messages;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  perform private.chat_assert_staff();
  select * into v from public.chat_messages where id = p_id;
  if v.id is null or not public.chat_is_member(v.conversation_id) then
    perform private.raise_app_error('NOT_FOUND', 'message');
  end if;
  if v.sender_id is distinct from auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'chat');
  end if;
  if v.deleted_at is not null or now() - v.created_at > interval '5 minutes' then
    perform private.raise_app_error('CONFLICT', 'chat_edit_expired');
  end if;
  if v_body is null and v.file_path is null then
    perform private.raise_app_error('VALIDATION', 'chat_empty');
  end if;
  if length(coalesce(v_body, '')) > 4000 then
    perform private.raise_app_error('VALIDATION', 'chat_too_long');
  end if;
  if v_body is distinct from v.body then
    update public.chat_messages set body = v_body, edited_at = now() where id = p_id;
  end if;
end;
$$;
grant execute on function public.chat_edit_message(uuid, text) to authenticated;

drop function public.chat_messages_page(uuid, timestamptz, int);

/** A page of a conversation's messages, newest first. */
create function public.chat_messages_page(p_conversation uuid, p_before timestamptz default null, p_limit int default 50)
returns table (id uuid, sender_id uuid, sender_name text, body text, file_path text, file_kind text, file_name text, created_at timestamptz, deleted boolean, edited boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cleared timestamptz;
begin
  perform private.chat_assert_member(p_conversation);
  select m.cleared_at into v_cleared from public.chat_members m where m.conversation_id = p_conversation and m.user_id = auth.uid();
  return query
  select m.id, m.sender_id, (select p.full_name from public.profiles p where p.user_id = m.sender_id),
         case when m.deleted_at is null then m.body end,
         case when m.deleted_at is null then m.file_path end,
         case when m.deleted_at is null then m.file_kind end,
         case when m.deleted_at is null then m.file_name end,
         m.created_at, m.deleted_at is not null, m.deleted_at is null and m.edited_at is not null
    from public.chat_messages m
   where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
     and (v_cleared is null or m.created_at > v_cleared)
   order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
grant execute on function public.chat_messages_page(uuid, timestamptz, int) to authenticated;
