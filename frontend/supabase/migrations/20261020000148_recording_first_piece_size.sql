-- A recording's size also counts its first piece.
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

  select r.id, (select p.full_name from public.profiles p where p.user_id = r.requested_by) as requester into v_request
    from public.staff_screen_requests r
   where r.user_id = auth.uid() and r.status = 'pending' and r.created_at > now() - interval '10 minutes'
   order by r.created_at desc limit 1;
  return case when v_request.id is null then null
              else jsonb_build_object('id', v_request.id, 'requester', v_request.requester) end;
end;
$$;
