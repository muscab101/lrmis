-- Staff chat shows everyone's profile photo, and a person's profile when you press them: name, roles, districts,
-- email, phone, when they were last online and since when they are on LRMIS. Staff only, about staff only.

drop function public.chat_list();
create function public.chat_list()
returns table (id uuid, kind text, name text, last_message_at timestamptz, last_body text, last_file_kind text, last_sender text,
               unread int, member_count int, created_by uuid, other_user uuid, photo_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  return query
  select c.id, c.kind,
         coalesce(c.name, op.full_name, '—'),
         c.last_message_at, l.body, l.file_kind, l.sender,
         (select count(*)::int from public.chat_messages x
           where x.conversation_id = c.id and x.deleted_at is null and x.created_at > me.last_read_at and x.sender_id is distinct from auth.uid()),
         (select count(*)::int from public.chat_members a where a.conversation_id = c.id),
         c.created_by,
         case when c.kind = 'direct' then op.user_id end,
         case when c.kind = 'direct' then op.avatar_path end
    from public.chat_members me
    join public.chat_conversations c on c.id = me.conversation_id
    left join lateral (
      select p.user_id, p.full_name, p.avatar_path from public.chat_members o join public.profiles p on p.user_id = o.user_id
       where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) op on true
    left join lateral (
      select x.body, x.file_kind, (select p.full_name from public.profiles p where p.user_id = x.sender_id) as sender
        from public.chat_messages x
       where x.conversation_id = c.id and x.deleted_at is null and (me.cleared_at is null or x.created_at > me.cleared_at)
       order by x.created_at desc limit 1) l on true
   where me.user_id = auth.uid() and not me.hidden and c.deleted_at is null
   order by c.last_message_at desc;
end;
$$;
grant execute on function public.chat_list() to authenticated;

drop function public.chat_directory(text);
create function public.chat_directory(p_q text default '')
returns table (user_id uuid, full_name text, email text, photo_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  return query
  select p.user_id, p.full_name, p.email, p.avatar_path from public.profiles p
   where p.kind = 'staff' and p.status = 'active' and p.user_id <> auth.uid()
     and (coalesce(trim(p_q), '') = '' or p.full_name ilike '%' || trim(p_q) || '%' or p.email ilike '%' || trim(p_q) || '%')
   order by p.full_name limit 50;
end;
$$;
grant execute on function public.chat_directory(text) to authenticated;

drop function public.chat_members_of(uuid);
create function public.chat_members_of(p_conversation uuid)
returns table (user_id uuid, full_name text, email text, photo_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_member(p_conversation);
  return query select p.user_id, p.full_name, p.email, p.avatar_path from public.chat_members m join public.profiles p on p.user_id = m.user_id
   where m.conversation_id = p_conversation order by p.full_name;
end;
$$;
grant execute on function public.chat_members_of(uuid) to authenticated;

/** One staff member's profile, for another staff member. */
create or replace function public.chat_profile(p_user uuid)
returns table (user_id uuid, full_name text, email text, phone text, photo_path text, roles_en text[], roles_so text[],
               districts text[], all_districts boolean, last_seen timestamptz, joined timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.chat_assert_staff();
  return query
  select p.user_id, p.full_name, p.email, p.phone, p.avatar_path,
         array(select r.name_en from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         array(select r.name_so from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.user_id order by r.name_en),
         array(select d.name_so from public.user_districts ud join public.districts d on d.id = ud.district_id where ud.user_id = p.user_id order by d.name_so),
         coalesce(p.all_districts, false),
         greatest((select max(s.last_at) from public.staff_recordings s where s.user_id = p.user_id), p.last_login_at),
         p.created_at
    from public.profiles p
   where p.user_id = p_user and p.kind = 'staff' and p.status <> 'deleted';
end;
$$;
grant execute on function public.chat_profile(uuid) to authenticated;
