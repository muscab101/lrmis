-- A citizen sees the land of every owner whose phone is the one they signed in with (verified by SMS code), not only
-- the one owner record linked to their account. Staff often put the same contact phone on several owners (one family,
-- one person managing several plots); bills and SMS already go to that phone, so its holder is their contact.

-- The owner records of the signed-in citizen: the one linked to the account, and every unlinked owner with the
-- account's verified phone. Uses auth.users.phone (only set once confirmed), never a phone the person can type.
create or replace function private.my_party_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.parties p where p.citizen_user_id = auth.uid() and p.deleted_at is null
  union
  select p.id
    from auth.users u
    join public.profiles pr on pr.user_id = u.id and pr.kind = 'citizen'
    join public.parties p on p.phone = '+' || ltrim(u.phone, '+') and p.citizen_user_id is null and p.deleted_at is null
   where u.id = auth.uid() and u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null;
$$;
revoke all on function private.my_party_ids() from public, anon;
grant execute on function private.my_party_ids() to authenticated;

do $do$
declare
  d text;
begin
  -- Owner of a parcel.
  d := pg_get_functiondef('private.is_parcel_owner(uuid)'::regprocedure);
  d := replace(d, 'po.valid_to is null and pa.citizen_user_id = auth.uid()', 'po.valid_to is null and pa.id in (select private.my_party_ids())');
  if position('my_party_ids' in d) = 0 then raise exception 'is_parcel_owner: text not found'; end if;
  execute d;

  -- Who can see a parcel.
  d := pg_get_functiondef('private.can_view_parcel(uuid)'::regprocedure);
  d := replace(d, 'po.valid_to is null and pa.citizen_user_id = auth.uid())', 'po.valid_to is null and pa.id in (select private.my_party_ids()))');
  if position('my_party_ids' in d) = 0 then raise exception 'can_view_parcel: text not found'; end if;
  execute d;

  -- The portal's overview.
  d := pg_get_functiondef('public.citizen_overview()'::regprocedure);
  d := replace(d, 'select p.id from public.parties p where p.citizen_user_id = auth.uid()', 'select private.my_party_ids() as id');
  if position('my_party_ids' in d) = 0 then raise exception 'citizen_overview: text not found'; end if;
  execute d;

  -- The citizen's applications.
  d := pg_get_functiondef('public.citizen_applications()'::regprocedure);
  d := replace(d, 'select id from public.parties where citizen_user_id = auth.uid() and deleted_at is null', 'select private.my_party_ids() as id');
  if position('my_party_ids' in d) = 0 then raise exception 'citizen_applications: text not found'; end if;
  execute d;
end;
$do$;

-- Messages to any of those owners.
do $do$
declare
  q text := (select qual from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select');
begin
  q := replace(q, 'WHERE ((p.id = messages.party_id) AND (p.citizen_user_id = ( SELECT auth.uid() AS uid)))',
                  'WHERE ((p.id = messages.party_id) AND (p.id IN ( SELECT private.my_party_ids() AS my_party_ids)))');
  if position('my_party_ids' in q) = 0 then raise exception 'messages_select: text not found'; end if;
  execute 'drop policy messages_select on public.messages';
  execute format('create policy messages_select on public.messages for select to authenticated using (%s)', q);
end;
$do$;
