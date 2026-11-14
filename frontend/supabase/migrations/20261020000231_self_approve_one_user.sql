-- The "second person" rule (nobody approves their own work) has one exception list: the Super Admins named in the
-- setting security.self_approve_users may approve what they made themselves. Everyone else still needs a second person.
insert into public.settings (key, value, description)
values ('security.self_approve_users', '[]'::jsonb, 'Super Admins who may approve their own work (user ids)')
on conflict (key) do nothing;

create or replace function private.assert_maker_checker(p_created_by uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_created_by is not null and p_created_by = auth.uid() then
    -- The named Super Admins only.
    if private.user_grants_all(auth.uid())
       and exists (select 1 from public.settings s
                    where s.key = 'security.self_approve_users'
                      and jsonb_typeof(s.value) = 'array'
                      and s.value ? auth.uid()::text) then
      return;
    end if;
    perform private.raise_app_error('MAKER_CHECKER');
  end if;
end;
$$;
