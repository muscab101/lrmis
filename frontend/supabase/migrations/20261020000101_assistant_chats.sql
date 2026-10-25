-- ============================================================================
-- 0101 AI assistant chat history. Each person keeps their own conversations
-- (staff, admin and citizen assistants alike); nobody else can read them.
-- ============================================================================

create table public.assistant_chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  title       text not null check (length(title) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index assistant_chats_user_idx on public.assistant_chats (user_id, updated_at desc);

create table public.assistant_messages (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references public.assistant_chats (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (length(content) <= 20000),
  created_at  timestamptz not null default now()
);
create index assistant_messages_chat_idx on public.assistant_messages (chat_id, id);

alter table public.assistant_chats    enable row level security;
alter table public.assistant_messages enable row level security;

revoke all on public.assistant_chats, public.assistant_messages from anon;
revoke update on public.assistant_chats from authenticated;
grant select, insert, delete on public.assistant_chats to authenticated;
grant update (title, updated_at) on public.assistant_chats to authenticated;
revoke update, delete on public.assistant_messages from authenticated;
grant select, insert on public.assistant_messages to authenticated;

create policy assistant_chats_own on public.assistant_chats for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy assistant_messages_select on public.assistant_messages for select to authenticated
  using (exists (select 1 from public.assistant_chats c where c.id = chat_id and c.user_id = (select auth.uid())));
create policy assistant_messages_insert on public.assistant_messages for insert to authenticated
  with check (exists (select 1 from public.assistant_chats c where c.id = chat_id and c.user_id = (select auth.uid())));
