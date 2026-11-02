-- Testing a user, and seeing how staff work (owner decision 2026-11-02).
-- Test login: a super admin opens the system as another staff member. Never another super admin; every use is logged.
-- Staff activity: pages opened, actions done and sign-ins, per person and day (audit.view).
-- Work recording: LRMIS records each staff session in the browser so it can be played back. Staff are told at sign-in and
-- by a sign in the top bar. Everything in LRMIS is recorded, Staff chat included; passwords are hidden. Kept 30 days.
-- Screen video: a super admin asks, the staff member accepts or declines in the browser's own prompt.
-- Only super admins can watch recordings, and each viewing is logged.

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('staff-recordings', 'staff-recordings', false, 104857600, array['application/gzip', 'video/webm', 'video/mp4'])
  on conflict (id) do nothing;
exception when others then
  raise notice 'storage not available: %', sqlerrm;
end $$;

create table public.staff_recordings (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The super admin who was testing as this user, when it was a test.
  tested_by   uuid references auth.users (id) on delete set null,
  started_at  timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  bytes       bigint not null default 0
);
alter table public.staff_recordings enable row level security;
create index staff_recordings_user_idx on public.staff_recordings (user_id, started_at desc);
create index staff_recordings_seen_idx on public.staff_recordings (user_id, last_at desc);

create table public.staff_recording_chunks (
  recording_id uuid not null references public.staff_recordings (id) on delete cascade,
  seq          int not null,
  path         text not null,
  bytes        bigint not null,
  at           timestamptz not null default now(),
  primary key (recording_id, seq)
);
alter table public.staff_recording_chunks enable row level security;
create index staff_recording_chunks_at_idx on public.staff_recording_chunks (at);

create table public.staff_page_views (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  path      text not null,
  at        timestamptz not null default now()
);
alter table public.staff_page_views enable row level security;
create index staff_page_views_user_idx on public.staff_page_views (user_id, at desc);

create table public.staff_screen_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  requested_by  uuid references auth.users (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'sharing', 'done', 'declined', 'failed')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  ended_at      timestamptz,
  file_path     text,
  bytes         bigint
);
alter table public.staff_screen_requests enable row level security;
create index staff_screen_requests_user_idx on public.staff_screen_requests (user_id, created_at desc);

create or replace function private.assert_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.user_grants_all(auth.uid()) then
    perform private.raise_app_error('PERMISSION_DENIED', 'super_admin');
  end if;
end;
$$;

/** Checks a test login is allowed and logs it. Returns the email the server signs in with. */
create or replace function public.admin_test_login_start(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles;
begin
  perform private.assert_super_admin();
  select * into v from public.profiles where user_id = p_user and kind = 'staff';
  if v.user_id is null or v.status not in ('active', 'invited') or v.email is null then
    perform private.raise_app_error('VALIDATION', 'test_login_person');
  end if;
  if p_user = auth.uid() or private.user_grants_all(p_user) then
    perform private.raise_app_error('CONFLICT', 'test_login_super_admin');
  end if;
  perform private.audit('test_login.start', 'profiles', p_user::text, null, jsonb_build_object('email', v.email));
  return v.email;
end;
$$;

create or replace function public.admin_test_login_stop(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_super_admin();
  perform private.audit('test_login.stop', 'profiles', p_user::text, null, null);
end;
$$;

/**
 * Saves one piece of the signed-in person's recording (or, with no file, just says they are still here) and what pages
 * they opened. Answers with a screen video request waiting for them, if any.
 */
create or replace function public.recording_save(p_recording uuid, p_seq int, p_path text, p_bytes bigint, p_pages jsonb, p_tested_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_request record;
begin
  perform private.chat_assert_staff();
  select user_id into v_owner from public.staff_recordings where id = p_recording;
  if v_owner is not null and v_owner <> auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'recording');
  end if;
  if p_path is not null and p_path !~ ('^' || auth.uid()::text || '/' || p_recording::text || '/[0-9]+\.json\.gz$') then
    perform private.raise_app_error('VALIDATION', 'recording_path');
  end if;
  insert into public.staff_recordings (id, user_id, tested_by) values (p_recording, auth.uid(), p_tested_by)
  on conflict (id) do update set last_at = now(), bytes = public.staff_recordings.bytes + coalesce(p_bytes, 0);
  if p_path is not null then
    insert into public.staff_recording_chunks (recording_id, seq, path, bytes)
    values (p_recording, p_seq, p_path, coalesce(p_bytes, 0)) on conflict do nothing;
  end if;
  insert into public.staff_page_views (user_id, path, at)
  select auth.uid(), left(x ->> 'path', 300),
         least(now(), greatest(now() - interval '10 minutes', coalesce((x ->> 'at')::timestamptz, now())))
    from jsonb_array_elements(case when jsonb_typeof(p_pages) = 'array' then p_pages else '[]'::jsonb end) x
   where x ->> 'path' is not null;

  select r.id, (select p.full_name from public.profiles p where p.user_id = r.requested_by) as requester into v_request
    from public.staff_screen_requests r
   where r.user_id = auth.uid() and r.status = 'pending' and r.created_at > now() - interval '10 minutes'
   order by r.created_at desc limit 1;
  return case when v_request.id is null then null
              else jsonb_build_object('id', v_request.id, 'requester', v_request.requester) end;
end;
$$;

/** Everyone's day at a glance. */
create or replace function public.staff_activity_list(p_day date default null)
returns table (user_id uuid, full_name text, email text, status text, roles_so text[], roles_en text[], last_seen timestamptz,
               pages int, actions int, last_action text, last_table text, last_action_at timestamptz, recordings int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Mogadishu')::date);
  v_from timestamptz := v_day::timestamp at time zone 'Africa/Mogadishu';
  v_to timestamptz := (v_day + 1)::timestamp at time zone 'Africa/Mogadishu';
begin
  perform private.assert_permission('audit.view');
  return query
  select p.user_id, p.full_name, p.email, p.status::text,
         array(select r.name_so from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         array(select r.name_en from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         (select max(s.last_at) from public.staff_recordings s where s.user_id = p.user_id),
         (select count(*)::int from public.staff_page_views v where v.user_id = p.user_id and v.at >= v_from and v.at < v_to),
         (select count(*)::int from public.audit_log a where a.actor_id = p.user_id and a.at >= v_from and a.at < v_to),
         la.action, la.table_name, la.at,
         (select count(*)::int from public.staff_recordings s where s.user_id = p.user_id and s.started_at >= v_from and s.started_at < v_to)
    from public.profiles p
    left join lateral (select a.action, a.table_name, a.at from public.audit_log a where a.actor_id = p.user_id order by a.at desc limit 1) la on true
   where p.kind = 'staff' and p.status <> 'deleted'
   order by (select max(s.last_at) from public.staff_recordings s where s.user_id = p.user_id) desc nulls last, p.full_name;
end;
$$;

/** One person's day, newest first: sign-ins, pages opened, things done and tests of this account. */
create or replace function public.staff_activity_timeline(p_user uuid, p_day date default null)
returns table (kind text, at timestamptz, what text, table_name text, record_id text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Mogadishu')::date);
  v_from timestamptz := v_day::timestamp at time zone 'Africa/Mogadishu';
  v_to timestamptz := (v_day + 1)::timestamp at time zone 'Africa/Mogadishu';
begin
  perform private.assert_permission('audit.view');
  return query
  select * from (
    select 'action'::text, a.at, a.action, a.table_name, a.record_id, null::text
      from public.audit_log a where a.actor_id = p_user and a.at >= v_from and a.at < v_to
    union all
    select 'test'::text, a.at, a.action, a.table_name, a.record_id, a.actor_email
      from public.audit_log a where a.action like 'test_login.%' and a.record_id = p_user::text and a.at >= v_from and a.at < v_to
    union all
    select 'page'::text, v.at, v.path, null, null, null
      from public.staff_page_views v where v.user_id = p_user and v.at >= v_from and v.at < v_to
    union all
    select 'login'::text, l.at, l.method, null, null, case when l.success then null else coalesce(l.reason, 'failed') end
      from public.login_events l where l.user_id = p_user and l.at >= v_from and l.at < v_to
  ) t order by 2 desc limit 500;
end;
$$;

create or replace function public.staff_recordings_of(p_user uuid, p_day date default null)
returns table (id uuid, started_at timestamptz, last_at timestamptz, bytes bigint, pieces int, tested_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Mogadishu')::date);
begin
  perform private.assert_super_admin();
  return query
  select s.id, s.started_at, s.last_at, s.bytes,
         (select count(*)::int from public.staff_recording_chunks c where c.recording_id = s.id),
         (select p.full_name from public.profiles p where p.user_id = s.tested_by)
    from public.staff_recordings s
   where s.user_id = p_user
     and s.started_at >= v_day::timestamp at time zone 'Africa/Mogadishu'
     and s.started_at < (v_day + 1)::timestamp at time zone 'Africa/Mogadishu'
     and exists (select 1 from public.staff_recording_chunks c where c.recording_id = s.id)
   order by s.started_at desc;
end;
$$;

/** The pieces of a recording, in order. Watching it is logged. */
create or replace function public.recording_watch(p_recording uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_super_admin();
  perform private.audit('recording.watch', 'staff_recordings', p_recording::text, null, null);
  return query select c.path from public.staff_recording_chunks c where c.recording_id = p_recording order by c.seq;
end;
$$;

create or replace function public.screen_request(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_super_admin();
  if not exists (select 1 from public.profiles p where p.user_id = p_user and p.kind = 'staff' and p.status = 'active') or p_user = auth.uid() then
    perform private.raise_app_error('VALIDATION', 'screen_person');
  end if;
  if exists (select 1 from public.staff_screen_requests r where r.user_id = p_user and r.status in ('pending', 'sharing') and r.created_at > now() - interval '20 minutes') then
    perform private.raise_app_error('CONFLICT', 'screen_waiting');
  end if;
  insert into public.staff_screen_requests (user_id, requested_by) values (p_user, auth.uid()) returning id into v_id;
  perform private.audit('screen.request', 'staff_screen_requests', v_id::text, null, jsonb_build_object('user_id', p_user));
  perform private.notify(p_user, 'screen.request', 'Maamulaha ayaa codsaday inuu arko shaashaddaada', 'An admin asked to see your screen', null);
  return v_id;
end;
$$;

/** The staff member answers: sharing, declined or failed. */
create or replace function public.screen_respond(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sharing', 'declined', 'failed') then
    perform private.raise_app_error('VALIDATION', 'screen_status');
  end if;
  update public.staff_screen_requests set status = p_status, responded_at = now(),
         ended_at = case when p_status = 'sharing' then null else now() end
   where id = p_id and user_id = auth.uid() and status in ('pending', 'sharing');
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'screen_request');
  end if;
end;
$$;

create or replace function public.screen_finish(p_id uuid, p_path text, p_bytes bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path !~ ('^' || auth.uid()::text || '/screen/' || p_id::text || '\.(webm|mp4)$') then
    perform private.raise_app_error('VALIDATION', 'recording_path');
  end if;
  update public.staff_screen_requests set status = 'done', ended_at = now(), file_path = p_path, bytes = p_bytes
   where id = p_id and user_id = auth.uid() and status = 'sharing';
  if not found then
    perform private.raise_app_error('NOT_FOUND', 'screen_request');
  end if;
end;
$$;

create or replace function public.screen_requests_of(p_user uuid)
returns table (id uuid, status text, created_at timestamptz, ended_at timestamptz, bytes bigint, has_file boolean, requester text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_super_admin();
  return query
  select r.id, r.status, r.created_at, r.ended_at, r.bytes, r.file_path is not null,
         (select p.full_name from public.profiles p where p.user_id = r.requested_by)
    from public.staff_screen_requests r where r.user_id = p_user order by r.created_at desc limit 20;
end;
$$;

/** The file of a screen video. Watching it is logged. */
create or replace function public.screen_watch(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  perform private.assert_super_admin();
  select file_path into v_path from public.staff_screen_requests where id = p_id;
  if v_path is null then
    perform private.raise_app_error('NOT_FOUND', 'screen_request');
  end if;
  perform private.audit('screen.watch', 'staff_screen_requests', p_id::text, null, null);
  return v_path;
end;
$$;

/** Files past the 30 days. The server removes them from storage, then calls recording_forget. */
create or replace function public.recording_expired(p_limit int default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select path from (
    select c.path from public.staff_recording_chunks c where c.at < now() - interval '30 days'
    union all
    select r.file_path from public.staff_screen_requests r where r.file_path is not null and r.created_at < now() - interval '30 days'
  ) t limit p_limit;
$$;

create or replace function public.recording_forget(p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.staff_recording_chunks where path = any (p_paths);
  update public.staff_screen_requests set file_path = null where file_path = any (p_paths);
  delete from public.staff_recordings s where s.last_at < now() - interval '30 days'
     and not exists (select 1 from public.staff_recording_chunks c where c.recording_id = s.id);
  delete from public.staff_page_views where at < now() - interval '30 days';
end;
$$;

grant execute on function public.admin_test_login_start(uuid) to authenticated;
grant execute on function public.admin_test_login_stop(uuid) to authenticated;
grant execute on function public.recording_save(uuid, int, text, bigint, jsonb, uuid) to authenticated;
grant execute on function public.staff_activity_list(date) to authenticated;
grant execute on function public.staff_activity_timeline(uuid, date) to authenticated;
grant execute on function public.staff_recordings_of(uuid, date) to authenticated;
grant execute on function public.recording_watch(uuid) to authenticated;
grant execute on function public.screen_request(uuid) to authenticated;
grant execute on function public.screen_respond(uuid, text) to authenticated;
grant execute on function public.screen_finish(uuid, text, bigint) to authenticated;
grant execute on function public.screen_requests_of(uuid) to authenticated;
grant execute on function public.screen_watch(uuid) to authenticated;
-- The server's own cleanup: nobody signed in may call these.
revoke all on function public.recording_expired(int) from public, anon, authenticated;
revoke all on function public.recording_forget(text[]) from public, anon, authenticated;
grant execute on function public.recording_expired(int) to service_role;
grant execute on function public.recording_forget(text[]) to service_role;
