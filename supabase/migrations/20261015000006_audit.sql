-- ============================================================================
-- 0006 Audit log: generic row trigger + explicit events from RPCs. Append-only.
-- ============================================================================

create or replace function private.audit(
  p_action text, p_table text, p_record_id text, p_before jsonb, p_after jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, actor_email, action, table_name, record_id, before, after,
                                ip, user_agent, request_id)
  values (
    auth.uid(),
    (select email from public.profiles where user_id = auth.uid()),
    p_action, p_table, p_record_id, p_before, p_after,
    private.request_ip(),
    private.request_header('user-agent'),
    private.request_id()
  );
end;
$$;

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_pk     text  := coalesce(tg_argv[0], 'id');
begin
  -- Skip no-op updates and pure bookkeeping changes (timestamps of logins etc.).
  if tg_op = 'UPDATE'
     and (v_before - array['updated_at', 'last_login_at']) = (v_after - array['updated_at', 'last_login_at']) then
    return new;
  end if;
  perform private.audit(
    lower(tg_op), tg_table_name,
    coalesce(v_after ->> v_pk, v_before ->> v_pk),
    v_before, v_after
  );
  return coalesce(new, old);
end;
$$;

create trigger audit after insert or update or delete on public.regions
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.districts
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.profiles
  for each row execute function private.audit_row('user_id');
create trigger audit after insert or update or delete on public.roles
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.settings
  for each row execute function private.audit_row('key');
-- role_permissions / user_roles / user_districts are audited as one summarised event
-- per change by the admin RPCs (one row instead of hundreds).

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();
