-- Real screen video removed (owner decision 2026-11-02): recording stays inside LRMIS and nobody has to accept anything.
drop function public.screen_request(uuid);
drop function public.screen_respond(uuid, text);
drop function public.screen_finish(uuid, text, bigint);
drop function public.screen_requests_of(uuid);
drop function public.screen_watch(uuid);
drop function public.recording_save(uuid, int, text, bigint, jsonb, uuid);

/** Saves one piece of the signed-in person's recording (or, with no file, just says they are still here) and what pages they opened. */
create function public.recording_save(p_recording uuid, p_seq int, p_path text, p_bytes bigint, p_pages jsonb, p_tested_by uuid default null)
returns void
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
end;
$$;
grant execute on function public.recording_save(uuid, int, text, bigint, jsonb, uuid) to authenticated;

/** Files past the 30 days. The server removes them from storage, then calls recording_forget. */
create or replace function public.recording_expired(p_limit int default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.path from public.staff_recording_chunks c where c.at < now() - interval '30 days' limit p_limit;
$$;

create or replace function public.recording_forget(p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.staff_recording_chunks where path = any (p_paths);
  delete from public.staff_recordings s where s.last_at < now() - interval '30 days'
     and not exists (select 1 from public.staff_recording_chunks c where c.recording_id = s.id);
  delete from public.staff_page_views where at < now() - interval '30 days';
end;
$$;

drop table public.staff_screen_requests;
