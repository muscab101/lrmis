-- ============================================================================
-- 0059 Admins change a staff member's sign-in email (Admin → Users).
--
-- New user action 'change_email' (users.update, same target rules as the
-- other actions). After the Auth Admin API has changed the address, the
-- profile copy is updated, the user's sessions are signed out, and the change
-- is audited and notified.
-- ============================================================================

create or replace function public.admin_authorize_user_action(p_user_id uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_action
    when 'suspend', 'reactivate' then
      perform private.assert_permission('users.manage');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'soft_delete' then
      perform private.assert_permission('users.delete');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'hard_delete' then
      perform private.assert_permission('users.delete');
      perform private.assert_can_manage_user(p_user_id, false);
      if not private.user_grants_all(auth.uid()) then
        perform private.raise_app_error('PERMISSION_DENIED', 'hard_delete');
      end if;
      if (public.admin_user_record_counts(p_user_id) ->> 'total')::int > 0 then
        perform private.raise_app_error('HAS_RECORDS');
      end if;
    when 'set_password', 'send_reset_link' then
      perform private.assert_permission('users.reset_password');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'reset_2fa' then
      perform private.assert_permission('users.reset_2fa');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'force_signout' then
      perform private.assert_permission('users.force_signout');
      perform private.assert_can_manage_user(p_user_id, true);
    when 'change_email' then
      perform private.assert_permission('users.update');
      perform private.assert_can_manage_user(p_user_id, false);
    when 'resend_invite' then
      perform private.assert_permission('users.create');
      perform private.assert_can_manage_user(p_user_id, false);
    else
      perform private.raise_app_error('VALIDATION', 'unknown action');
  end case;
end;
$$;

create function public.admin_set_user_email(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_email text := lower(trim(p_email));
begin
  perform public.admin_authorize_user_action(p_user_id, 'change_email');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.raise_app_error('VALIDATION', 'email');
  end if;
  v_before := private.user_snapshot(p_user_id);
  update public.profiles set email = v_email, sessions_revoked_at = now() where user_id = p_user_id;
  perform private.delete_auth_sessions(p_user_id);
  perform private.audit('user.change_email', 'profiles', p_user_id::text, v_before, private.user_snapshot(p_user_id));
  perform private.notify(p_user_id, 'account.change_email',
    'Iimaylka akoonkaaga waa la beddelay', 'Your account email was changed');
  return private.user_snapshot(p_user_id);
end;
$$;
revoke all on function public.admin_set_user_email(uuid, text) from public, anon;
grant execute on function public.admin_set_user_email(uuid, text) to authenticated;
