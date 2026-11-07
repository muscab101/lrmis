-- Live screens without the wait: while a super admin watches, the person's browser sends their screen straight to the
-- watcher over a private realtime channel, live:<user id>, instead of uploading pieces every few seconds. The pieces
-- are still saved for playback as before. Only the person and super admins may use their channel.

/** May the signed-in person send or receive on this live screen channel? Their own, or anyone's for a super admin. */
create or replace function public.live_channel_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_topic is null or p_topic !~ '^live:[0-9a-f-]{36}$' then
    return false;
  end if;
  return substr(p_topic, 6)::uuid = auth.uid() or private.user_grants_all(auth.uid());
end;
$$;
revoke all on function public.live_channel_allowed(text) from public, anon;
grant execute on function public.live_channel_allowed(text) to authenticated;

-- Tests run without realtime.
do $$
begin
  execute $p$create policy live_screen_receive on realtime.messages for select to authenticated
    using (extension = 'broadcast' and public.live_channel_allowed((select realtime.topic())))$p$;
  execute $p$create policy live_screen_send on realtime.messages for insert to authenticated
    with check (extension = 'broadcast' and public.live_channel_allowed((select realtime.topic())))$p$;
exception when others then
  raise notice 'realtime not available: %', sqlerrm;
end;
$$;
