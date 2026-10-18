-- ============================================================================
-- 0034 Accounts Settings → Cashiers needs cashier names. Finance and accounting roles may now
-- look up staff display names too; they only ever get staff, never citizens.
-- ============================================================================

create or replace function public.staff_display_names(p_user_ids uuid[])
returns table (user_id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.has_permission('users.view') or public.has_permission('audit.view');
begin
  if not (v_admin or public.has_permission('accounting.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED');
  end if;
  return query
    select p.user_id, p.full_name, case when v_admin then p.email end
      from public.profiles p
     where p.user_id = any (p_user_ids) and (v_admin or p.kind = 'staff');
end;
$$;
