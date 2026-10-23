-- Names of the staff on collection records (cashier, preparer, approver, uploader) for finance staff, who don't
-- otherwise read other users' profiles. Names only.
create or replace function public.staff_names(p_ids uuid[])
returns table (user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve') or public.has_permission('payments.view')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  if cardinality(p_ids) > 500 then
    perform private.raise_app_error('VALIDATION', 'ids');
  end if;
  return query select p.user_id, p.full_name from public.profiles p where p.user_id = any (p_ids);
end;
$$;
revoke all on function public.staff_names(uuid[]) from public, anon;
grant execute on function public.staff_names(uuid[]) to authenticated;
