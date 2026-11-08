-- A warning goes to every screen, or only to the staff of one district (and those who cover every district).
alter table public.system_warnings add column if not exists district_id uuid references public.districts (id);

drop policy if exists system_warnings_read on public.system_warnings;
create policy system_warnings_read on public.system_warnings for select to authenticated
  using (district_id is null or public.can_access_district(district_id));

drop function if exists public.system_warning_send(text);
create or replace function public.system_warning_send(p_message text, p_district uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_permission('messages.broadcast');
  if length(trim(coalesce(p_message, ''))) not between 3 and 300 then
    perform private.raise_app_error('VALIDATION', 'warning_message');
  end if;
  if p_district is not null and not public.can_access_district(p_district) then
    perform private.raise_app_error('NOT_FOUND', 'district');
  end if;
  -- At most one warning every 15 seconds per person, so screens are not flooded.
  if exists (select 1 from public.system_warnings w where w.created_by = auth.uid() and w.created_at > now() - interval '15 seconds') then
    perform private.raise_app_error('CONFLICT', 'warning_too_soon');
  end if;
  insert into public.system_warnings (message, district_id) values (trim(p_message), p_district) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.system_warning_send(text, uuid) from public, anon;
grant execute on function public.system_warning_send(text, uuid) to authenticated;
