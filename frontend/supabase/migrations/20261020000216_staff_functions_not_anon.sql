-- Staff-only database functions can't be called by someone who isn't signed in (they already refuse inside; now the
-- door is shut too). Signed-in users and the server keep their access. Functions meant for the public stay open:
-- pay links, certificate check, application tracking, notices, setup, print agents (with their key) and map tiles.

do $$
declare
  r record;
  v_staff text[] := array[
    'admin_test_login_start', 'admin_test_login_stop',
    'billing_run_batch_bills', 'billing_run_batches', 'billing_run_issue_now',
    'chat_add_members', 'chat_create_group', 'chat_delete', 'chat_delete_message', 'chat_directory', 'chat_edit_message',
    'chat_is_member', 'chat_list', 'chat_mark_read', 'chat_members_of', 'chat_messages_page', 'chat_open_direct',
    'chat_profile', 'chat_remove_member', 'chat_send',
    'demolition_candidates', 'demolition_decide', 'demolition_history', 'demolition_request', 'demolition_reregister',
    'demolition_restore', 'demolition_stats',
    'document_print_status', 'document_send_to_printer', 'document_send_to_printer_bulk',
    'land_with_units_create', 'parcel_delete', 'parcel_register',
    'printer_new_key', 'printer_overview', 'printer_resolve_alert', 'printer_save', 'printer_set_active',
    'recording_live_pieces', 'recording_save', 'recording_watch',
    'staff_activity_list', 'staff_activity_timeline', 'staff_live_list', 'staff_recordings_of', 'staff_work_done'];
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_staff)
  loop
    execute format('revoke all on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;
end;
$$;
