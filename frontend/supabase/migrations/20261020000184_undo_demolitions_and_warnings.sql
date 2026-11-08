-- 1. Undo many demolitions at once. When a whole neighbourhood was marked demolished by mistake, the approver can put
--    every house back in one go (each one is checked and recorded exactly as a single undo is).
-- 2. Warnings to everyone. An admin writes a short warning; it shows on every open screen in the system for 5 seconds
--    and then goes away. New permission `messages.broadcast` (Admin has it).

create or replace function public.demolition_restore_many(p_ids uuid[], p_reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  n int := 0;
begin
  perform private.assert_permission('parcels.demolish_approve');
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 2000 then
    perform private.raise_app_error('VALIDATION', 'demolish_selection');
  end if;
  -- Only the ones that can still be undone (demolished, not rebuilt, in the person's districts); the rest are skipped.
  for v_id in
    select d.id from public.demolitions d
     where d.id = any (p_ids) and d.status = 'approved' and d.rebuilt_at is null
       and public.can_access_district(d.district_id)
     order by d.number
  loop
    perform public.demolition_restore(v_id, p_reason);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.demolition_restore_many(uuid[], text) from public, anon;
grant execute on function public.demolition_restore_many(uuid[], text) to authenticated;

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('messages.broadcast', 'messages', 'broadcast', true,
        'Send a warning that shows on every screen for 5 seconds',
        'U dir digniin ka muuqata shaashad kasta 5 ilbiriqsi', 1909)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'messages.broadcast' from public.roles r where r.key = 'admin'
on conflict do nothing;
update public.roles
   set default_permissions = array(select distinct x from unnest(default_permissions || array['messages.broadcast']) x)
 where key = 'admin';

create table if not exists public.system_warnings (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(trim(message)) between 3 and 300),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists system_warnings_created_idx on public.system_warnings (created_at desc);
alter table public.system_warnings enable row level security;
-- Every signed-in person sees the warnings (that is the point); only the function below writes them.
drop policy if exists system_warnings_read on public.system_warnings;
create policy system_warnings_read on public.system_warnings for select to authenticated using (true);
revoke all on public.system_warnings from anon;
grant select on public.system_warnings to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'system_warnings') then
    alter publication supabase_realtime add table public.system_warnings;
  end if;
end;
$$;

create or replace function public.system_warning_send(p_message text)
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
  -- One at a time: at most one warning every 15 seconds per person, so screens are not flooded.
  if exists (select 1 from public.system_warnings w where w.created_by = auth.uid() and w.created_at > now() - interval '15 seconds') then
    perform private.raise_app_error('CONFLICT', 'warning_too_soon');
  end if;
  insert into public.system_warnings (message) values (trim(p_message)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.system_warning_send(text) from public, anon;
grant execute on function public.system_warning_send(text) to authenticated;
