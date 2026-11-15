-- Citizens can pay by bank transfer: the city's bank account is shown on the pay page, with the reference to write
-- (the PUN, else the bill number). Staff then record the transfer from the bank statement (Payments → Record bank
-- payment) and it is matched to the land by that reference. The account is set on Payments → Providers.

insert into public.settings (key, value, description, is_public)
values ('payments.bank_account',
        jsonb_build_object('bank', '', 'account_name', '', 'account_no', '', 'branch', '', 'swift', ''),
        'Bank account citizens pay into by transfer (shown on the pay page)', true)
on conflict (key) do update set is_public = true;

/** Set the bank account shown to citizens for transfers. */
create or replace function public.payment_bank_account_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_permission('settings.update');
  v := jsonb_build_object(
    'bank', left(trim(coalesce(p ->> 'bank', '')), 80),
    'account_name', left(trim(coalesce(p ->> 'account_name', '')), 120),
    'account_no', left(trim(coalesce(p ->> 'account_no', '')), 60),
    'branch', left(trim(coalesce(p ->> 'branch', '')), 80),
    'swift', upper(left(trim(coalesce(p ->> 'swift', '')), 20)));
  update public.settings set value = v, updated_at = now(), updated_by = auth.uid() where key = 'payments.bank_account';
  return v;
end;
$$;
revoke all on function public.payment_bank_account_set(jsonb) from public, anon;
grant execute on function public.payment_bank_account_set(jsonb) to authenticated;
