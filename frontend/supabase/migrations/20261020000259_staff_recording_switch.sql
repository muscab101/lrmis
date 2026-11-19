-- Staff activity recording can be switched off (owner decision, 19 Nov 2026: off until further notice).
-- Setting security.staff_recording: true = staff screens are recorded as before; false = no recording.
-- Off: the staff screens don't start the recorder, and recording_save keeps nothing (so a tab opened before the
-- switch, still running the recorder until it reloads, stores nothing either). Recordings already kept stay
-- until their 30 days run out. Switch back on: update public.settings set value = 'true' where key = 'security.staff_recording'.

insert into public.settings (key, value, is_public, is_secret, description)
values ('security.staff_recording', 'false'::jsonb, false, false,
        'Record staff screens for Activity (true) or not (false)')
on conflict (key) do update set value = 'false'::jsonb, updated_at = now();

do $do$
declare
  v text := pg_get_functiondef('public.recording_save(uuid,integer,text,bigint,jsonb,uuid)'::regprocedure);
  v_new text := replace(v, E'  perform private.chat_assert_staff();\n',
    E'  perform private.chat_assert_staff();\n  -- Recording switched off (Settings: security.staff_recording): nothing is kept.\n  if not private.setting_bool(''security.staff_recording'', true) then\n    return false;\n  end if;\n');
begin
  if v_new = v then
    raise exception 'recording_save: text not found';
  end if;
  execute v_new;
end;
$do$;

/** Whether staff screens are recorded now (the staff shell asks, to start the recorder or not). */
create or replace function public.staff_recording_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting_bool('security.staff_recording', true);
$$;
revoke all on function public.staff_recording_on() from public, anon;
grant execute on function public.staff_recording_on() to authenticated;
