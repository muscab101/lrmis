-- Auth accounts that existed before Dhulka get a profile like any new sign-up: citizen,
-- active, citizen role. An admin can turn one into staff (or the Super Admin) later.
insert into public.profiles (user_id, kind, full_name, email, phone, status)
select u.id, 'citizen', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
       lower(u.email), nullif(u.phone, ''), 'active'
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id);

insert into public.user_roles (user_id, role_id)
select p.user_id, r.id
from public.profiles p cross join public.roles r
where r.key = 'citizen'
  and not exists (select 1 from public.user_roles ur where ur.user_id = p.user_id);
