-- Watching staff's LRMIS screens live (owner decision 2026-11-02). Super admins only, nothing for staff to accept; the
-- Recording sign stays on their screen and each start of a live watch is logged. While someone is watched, their browser
-- sends its recording every few seconds instead of every 30.

create table public.staff_live_watch (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  until    timestamptz not null
);
alter table public.staff_live_watch enable row level security;

drop function public.recording_save(uuid, int, text, bigint, jsonb, uuid);

/**
 * Saves one piece of the signed-in person's recording (or, with no file, just says they are still here) and what pages
 * they opened. Answers whether they are being watched live.
 */
create function public.recording_save(p_recording uuid, p_seq int, p_path text, p_bytes bigint, p_pages jsonb, p_tested_by uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.chat_assert_staff();
  select user_id into v_owner from public.staff_recordings where id = p_recording;
  if v_owner is not null and v_owner <> auth.uid() then
    perform private.raise_app_error('PERMISSION_DENIED', 'recording');
  end if;
  if p_path is not null and p_path !~ ('^' || auth.uid()::text || '/' || p_recording::text || '/[0-9]+\.json\.gz$') then
    perform private.raise_app_error('VALIDATION', 'recording_path');
  end if;
  insert into public.staff_recordings (id, user_id, tested_by, bytes) values (p_recording, auth.uid(), p_tested_by, coalesce(p_bytes, 0))
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
  return exists (select 1 from public.staff_live_watch w where w.user_id = auth.uid() and w.until > now());
end;
$$;
grant execute on function public.recording_save(uuid, int, text, bigint, jsonb, uuid) to authenticated;

/** Staff with LRMIS open right now, other than me. */
create or replace function public.staff_live_list()
returns table (user_id uuid, full_name text, email text, roles_so text[], roles_en text[], page text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_super_admin();
  return query
  select p.user_id, p.full_name, p.email,
         array(select r.name_so from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         array(select r.name_en from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         (select v.path from public.staff_page_views v where v.user_id = p.user_id order by v.at desc limit 1)
    from public.profiles p
   where p.kind = 'staff' and p.user_id <> auth.uid()
     and exists (select 1 from public.staff_recordings s where s.user_id = p.user_id and s.last_at > now() - interval '90 seconds')
   order by p.full_name;
end;
$$;

/**
 * Keeps a live watch going and gives the new pieces of the person's current recording. Stays on the recording being
 * watched while it is alive, so someone with two tabs open doesn't flip between them.
 */
create or replace function public.recording_live_pieces(p_user uuid, p_recording uuid default null, p_after int default -1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_after int := p_after;
begin
  perform private.assert_super_admin();
  if p_user = auth.uid() then
    perform private.raise_app_error('VALIDATION', 'live_self');
  end if;
  if not exists (select 1 from public.staff_live_watch w where w.user_id = p_user and w.until > now()) then
    perform private.audit('recording.watch_live', 'profiles', p_user::text, null, null);
  end if;
  insert into public.staff_live_watch (user_id, until) values (p_user, now() + interval '30 seconds')
  on conflict (user_id) do update set until = excluded.until;

  select s.id into v_id from public.staff_recordings s
   where s.user_id = p_user and s.last_at > now() - interval '90 seconds'
   order by (s.id = p_recording) desc nulls last, s.started_at desc limit 1;
  if v_id is null then
    return jsonb_build_object('recording', null, 'pieces', '[]'::jsonb);
  end if;
  if v_id is distinct from p_recording then
    v_after := -1;
  end if;
  return jsonb_build_object('recording', v_id, 'pieces', coalesce((
    select jsonb_agg(jsonb_build_object('seq', c.seq, 'path', c.path) order by c.seq)
      from public.staff_recording_chunks c where c.recording_id = v_id and c.seq > v_after), '[]'::jsonb));
end;
$$;

grant execute on function public.staff_live_list() to authenticated;
grant execute on function public.recording_live_pieces(uuid, uuid, int) to authenticated;
