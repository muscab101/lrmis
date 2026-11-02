-- Deleting a chat. A direct chat goes from my list only and comes back, without the old messages, if a new one arrives;
-- the other person keeps theirs. A group is closed for everyone by the person who made it (others use Leave).
-- Nothing is erased: the rows stay, marked.

alter table public.chat_conversations add column deleted_at timestamptz;
alter table public.chat_members
  add column hidden boolean not null default false,
  add column cleared_at timestamptz;

/** Whether the signed-in person is in this conversation, and it is still open. */
create or replace function public.chat_is_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_members m
                   join public.chat_conversations c on c.id = m.conversation_id
                  where m.conversation_id = p_conversation and m.user_id = auth.uid() and c.deleted_at is null);
$$;

create or replace function public.chat_delete(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.chat_conversations;
  v_link text := '/chat?c=' || p_conversation::text;
begin
  perform private.chat_assert_member(p_conversation);
  select * into v from public.chat_conversations where id = p_conversation;
  if v.kind = 'group' then
    if v.created_by is distinct from auth.uid() then
      perform private.raise_app_error('PERMISSION_DENIED', 'chat');
    end if;
    update public.chat_conversations set deleted_at = now() where id = p_conversation;
    update public.notifications set read_at = now()
     where link = v_link and read_at is null
       and user_id in (select m.user_id from public.chat_members m where m.conversation_id = p_conversation);
  else
    update public.chat_members set hidden = true, cleared_at = now(), last_read_at = now()
     where conversation_id = p_conversation and user_id = auth.uid();
    update public.notifications set read_at = now() where user_id = auth.uid() and link = v_link and read_at is null;
  end if;
end;
$$;
grant execute on function public.chat_delete(uuid) to authenticated;

/** The chat with one person: opened if it exists, made if not. Opening it puts it back on my list. */
create or replace function public.chat_open_direct(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  perform private.chat_assert_staff();
  if p_user = auth.uid() or not exists (select 1 from public.profiles p where p.user_id = p_user and p.kind = 'staff' and p.status = 'active') then
    perform private.raise_app_error('VALIDATION', 'chat_person');
  end if;
  v_key := least(p_user::text, auth.uid()::text) || ':' || greatest(p_user::text, auth.uid()::text);
  select id into v_id from public.chat_conversations where direct_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (kind, direct_key, created_by) values ('direct', v_key, auth.uid()) returning id into v_id;
    insert into public.chat_members (conversation_id, user_id) values (v_id, auth.uid()), (v_id, p_user);
  else
    update public.chat_members set hidden = false where conversation_id = v_id and user_id = auth.uid();
  end if;
  return v_id;
end;
$$;

/** My conversations, newest first: the name to show, the last message and how many are unread. */
create or replace function public.chat_list()
returns table (id uuid, kind text, name text, last_message_at timestamptz, last_body text, last_file_kind text, last_sender text, unread int, member_count int, created_by uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  return query
  select c.id, c.kind,
         coalesce(c.name, (select p.full_name from public.chat_members o join public.profiles p on p.user_id = o.user_id
                            where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1), '—'),
         c.last_message_at, l.body, l.file_kind, l.sender,
         (select count(*)::int from public.chat_messages x
           where x.conversation_id = c.id and x.deleted_at is null and x.created_at > me.last_read_at and x.sender_id is distinct from auth.uid()),
         (select count(*)::int from public.chat_members a where a.conversation_id = c.id),
         c.created_by
    from public.chat_members me
    join public.chat_conversations c on c.id = me.conversation_id
    left join lateral (
      select x.body, x.file_kind, (select p.full_name from public.profiles p where p.user_id = x.sender_id) as sender
        from public.chat_messages x
       where x.conversation_id = c.id and x.deleted_at is null and (me.cleared_at is null or x.created_at > me.cleared_at)
       order by x.created_at desc limit 1) l on true
   where me.user_id = auth.uid() and not me.hidden and c.deleted_at is null
   order by c.last_message_at desc;
end;
$$;

/** A page of a conversation's messages, newest first. */
create or replace function public.chat_messages_page(p_conversation uuid, p_before timestamptz default null, p_limit int default 50)
returns table (id uuid, sender_id uuid, sender_name text, body text, file_path text, file_kind text, file_name text, created_at timestamptz, deleted boolean)
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
         m.created_at, m.deleted_at is not null
    from public.chat_messages m
   where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
     and (v_cleared is null or m.created_at > v_cleared)
   order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

/** Send text and/or a file already uploaded to this conversation's folder. The others get one bell notice per chat until they read it. */
create or replace function public.chat_send(p_conversation uuid, p_body text default null, p_file_path text default null, p_file_kind text default null, p_file_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_link text := '/chat?c=' || p_conversation::text;
  v_title text;
  r record;
begin
  perform private.chat_assert_member(p_conversation);
  if v_body is null and p_file_path is null then
    perform private.raise_app_error('VALIDATION', 'chat_empty');
  end if;
  if length(coalesce(v_body, '')) > 4000 then
    perform private.raise_app_error('VALIDATION', 'chat_too_long');
  end if;
  if p_file_path is not null and (p_file_kind is null or p_file_kind not in ('image', 'video')
       or p_file_path !~ ('^' || p_conversation::text || '/[0-9a-f-]{36}\.[a-z0-9]{2,5}$')) then
    perform private.raise_app_error('VALIDATION', 'chat_file');
  end if;
  insert into public.chat_messages (conversation_id, sender_id, body, file_path, file_kind, file_name)
  values (p_conversation, auth.uid(), v_body, p_file_path, case when p_file_path is not null then p_file_kind end, left(p_file_name, 200))
  returning id into v_id;
  update public.chat_conversations set last_message_at = now() where id = p_conversation;
  update public.chat_members set last_read_at = now() where conversation_id = p_conversation and user_id = auth.uid();
  -- A new message brings a chat back to anyone who had deleted it.
  update public.chat_members set hidden = false where conversation_id = p_conversation and hidden;
  select coalesce((select c.name from public.chat_conversations c where c.id = p_conversation),
                  (select p.full_name from public.profiles p where p.user_id = auth.uid()), '') into v_title;
  for r in select m.user_id from public.chat_members m where m.conversation_id = p_conversation and m.user_id <> auth.uid() loop
    if not exists (select 1 from public.notifications n where n.user_id = r.user_id and n.link = v_link and n.read_at is null) then
      perform private.notify(r.user_id, 'chat.message', 'Fariin cusub: ' || v_title, 'New message: ' || v_title, v_link);
    end if;
  end loop;
  return v_id;
end;
$$;
