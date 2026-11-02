-- Staff chat: staff talk one to one or in groups, and can send images and videos. Separate from Messages (SMS to owners).
-- Only members of a conversation can read it, and only through their own session; nobody else can, admins included.
-- Files live in a private bucket and are shown through short-lived links given to members only.

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('chat-media', 'chat-media', false, 52428800,
          array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

create table public.chat_conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('direct', 'group')),
  name             text check (name is null or length(trim(name)) between 2 and 80),
  -- The two people of a direct chat, in a fixed order: one chat per pair.
  direct_key       text unique,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  check ((kind = 'group') = (name is not null)),
  check ((kind = 'direct') = (direct_key is not null))
);
alter table public.chat_conversations enable row level security;

create table public.chat_members (
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.chat_members enable row level security;
create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  sender_id        uuid references auth.users (id) on delete set null,
  body             text check (body is null or length(body) <= 4000),
  file_path        text,
  file_kind        text check (file_kind is null or file_kind in ('image', 'video')),
  file_name        text check (file_name is null or length(file_name) <= 200),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check ((file_path is null) = (file_kind is null)),
  check (deleted_at is not null or file_path is not null or length(trim(coalesce(body, ''))) > 0)
);
alter table public.chat_messages enable row level security;
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);

/** Whether the signed-in person is in this conversation. */
create or replace function public.chat_is_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_members m where m.conversation_id = p_conversation and m.user_id = auth.uid());
$$;

-- Read only, members only (also what live updates obey). All writes go through the functions below.
create policy chat_conversations_read on public.chat_conversations for select to authenticated using (public.chat_is_member(id));
create policy chat_members_read on public.chat_members for select to authenticated using (public.chat_is_member(conversation_id));
create policy chat_messages_read on public.chat_messages for select to authenticated using (public.chat_is_member(conversation_id));

/** Only active staff use the chat. */
create or replace function private.chat_assert_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.kind = 'staff' and p.status = 'active') then
    perform private.raise_app_error('PERMISSION_DENIED', 'chat');
  end if;
end;
$$;

create or replace function private.chat_assert_member(p_conversation uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  if not public.chat_is_member(p_conversation) then
    perform private.raise_app_error('NOT_FOUND', 'conversation');
  end if;
end;
$$;

/** Staff to start a chat with. */
create or replace function public.chat_directory(p_q text default '')
returns table (user_id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  return query
  select p.user_id, p.full_name, p.email from public.profiles p
   where p.kind = 'staff' and p.status = 'active' and p.user_id <> auth.uid()
     and (coalesce(trim(p_q), '') = '' or p.full_name ilike '%' || trim(p_q) || '%' or p.email ilike '%' || trim(p_q) || '%')
   order by p.full_name limit 50;
end;
$$;

/** The chat with one person: opened if it exists, made if not. */
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
  end if;
  return v_id;
end;
$$;

create or replace function public.chat_create_group(p_name text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.chat_assert_staff();
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    perform private.raise_app_error('VALIDATION', 'chat_group_name');
  end if;
  if cardinality(array(select x from unnest(p_members) x where x <> auth.uid())) = 0 then
    perform private.raise_app_error('VALIDATION', 'chat_members');
  end if;
  if exists (select 1 from unnest(p_members) x where not exists (select 1 from public.profiles p where p.user_id = x and p.kind = 'staff' and p.status = 'active')) then
    perform private.raise_app_error('VALIDATION', 'chat_person');
  end if;
  insert into public.chat_conversations (kind, name, created_by) values ('group', trim(p_name), auth.uid()) returning id into v_id;
  insert into public.chat_members (conversation_id, user_id)
  select v_id, x from (select distinct unnest(p_members || auth.uid()) x) s;
  return v_id;
end;
$$;

/** Any member of a group can add people. */
create or replace function public.chat_add_members(p_conversation uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_member(p_conversation);
  if not exists (select 1 from public.chat_conversations c where c.id = p_conversation and c.kind = 'group') then
    perform private.raise_app_error('CONFLICT', 'chat_not_group');
  end if;
  if exists (select 1 from unnest(p_members) x where not exists (select 1 from public.profiles p where p.user_id = x and p.kind = 'staff' and p.status = 'active')) then
    perform private.raise_app_error('VALIDATION', 'chat_person');
  end if;
  insert into public.chat_members (conversation_id, user_id) select p_conversation, x from unnest(p_members) x on conflict do nothing;
end;
$$;

/** Leave a group; the person who made it can also remove others. */
create or replace function public.chat_remove_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.chat_conversations;
begin
  perform private.chat_assert_member(p_conversation);
  select * into v from public.chat_conversations where id = p_conversation;
  if v.kind <> 'group' then
    perform private.raise_app_error('CONFLICT', 'chat_not_group');
  end if;
  if p_user <> auth.uid() and v.created_by is distinct from auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'chat');
  end if;
  delete from public.chat_members where conversation_id = p_conversation and user_id = p_user;
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
        from public.chat_messages x where x.conversation_id = c.id and x.deleted_at is null order by x.created_at desc limit 1) l on true
   where me.user_id = auth.uid()
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
begin
  perform private.chat_assert_member(p_conversation);
  return query
  select m.id, m.sender_id, (select p.full_name from public.profiles p where p.user_id = m.sender_id),
         case when m.deleted_at is null then m.body end,
         case when m.deleted_at is null then m.file_path end,
         case when m.deleted_at is null then m.file_kind end,
         case when m.deleted_at is null then m.file_name end,
         m.created_at, m.deleted_at is not null
    from public.chat_messages m
   where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
   order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create or replace function public.chat_members_of(p_conversation uuid)
returns table (user_id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_member(p_conversation);
  return query select p.user_id, p.full_name, p.email from public.chat_members m join public.profiles p on p.user_id = m.user_id
   where m.conversation_id = p_conversation order by p.full_name;
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

create or replace function public.chat_mark_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_member(p_conversation);
  update public.chat_members set last_read_at = now() where conversation_id = p_conversation and user_id = auth.uid();
  update public.notifications set read_at = now() where user_id = auth.uid() and link = '/chat?c=' || p_conversation::text and read_at is null;
end;
$$;

/** Take back your own message. Returns its file, for the server to remove. */
create or replace function public.chat_delete_message(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.chat_messages;
begin
  perform private.chat_assert_staff();
  select * into v from public.chat_messages where id = p_id;
  if v.id is null or not public.chat_is_member(v.conversation_id) then
    perform private.raise_app_error('NOT_FOUND', 'message');
  end if;
  if v.sender_id is distinct from auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'chat');
  end if;
  update public.chat_messages set deleted_at = now(), body = null, file_path = null, file_kind = null, file_name = null where id = p_id;
  return v.file_path;
end;
$$;

grant execute on function public.chat_is_member(uuid) to authenticated;
grant execute on function public.chat_directory(text) to authenticated;
grant execute on function public.chat_open_direct(uuid) to authenticated;
grant execute on function public.chat_create_group(text, uuid[]) to authenticated;
grant execute on function public.chat_add_members(uuid, uuid[]) to authenticated;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;
grant execute on function public.chat_list() to authenticated;
grant execute on function public.chat_messages_page(uuid, timestamptz, int) to authenticated;
grant execute on function public.chat_members_of(uuid) to authenticated;
grant execute on function public.chat_send(uuid, text, text, text, text) to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_delete_message(uuid) to authenticated;

-- Live updates in the browser (RLS still decides who receives what).
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when others then
  raise notice 'realtime publication not available: %', sqlerrm;
end $$;
