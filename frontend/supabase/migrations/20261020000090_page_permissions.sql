-- Pages that borrowed another page's permission get their own, so a role can be given one without the other:
--   parcels.yet_to_register  Yet to register   (was parcels.view)
--   certificates.id_cards    ID cards          (was certificates.view)
--   reports.assistant        Reports assistant (was reports.view)
-- Every role that could open the page keeps it (protected roles such as Super admin already have everything). Cashiers open Yet to register with the new permission instead of
-- the parcels.view they were given for it, so they no longer see the Parcels list.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('parcels.yet_to_register', 'parcels', 'yet_to_register', true, 'Open Yet to register', 'Fur Weli lama diiwaangelin', 261)
on conflict (key) do nothing;
insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('certificates.id_cards', 'certificates', 'id_cards', true, 'Open ID cards', 'Fur kaarka aqoonsiga', 1851)
on conflict (key) do nothing;
insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('reports.assistant', 'reports', 'assistant', true, 'Use the reports assistant', 'Isticmaal kaaliyaha warbixinnada', 2050)
on conflict (key) do nothing;

do $$
declare
  m record;
begin
  for m in select * from (values ('parcels.view', 'parcels.yet_to_register'), ('certificates.view', 'certificates.id_cards'),
                                 ('reports.view', 'reports.assistant')) x(old_key, new_key) loop
    insert into public.role_permissions (role_id, permission_key)
    select rp.role_id, m.new_key from public.role_permissions rp join public.roles r on r.id = rp.role_id
     where rp.permission_key = m.old_key and not r.is_protected
    on conflict do nothing;
    update public.roles set default_permissions = default_permissions || array[m.new_key]
     where m.old_key = any (default_permissions) and not (m.new_key = any (default_permissions)) and not is_protected;
  end loop;
end;
$$;

-- Cashiers: Yet to register, not the whole Parcels list.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'parcels.yet_to_register' from public.roles r where r.key = 'cashier'
on conflict do nothing;
delete from public.role_permissions rp using public.roles r
 where r.id = rp.role_id and r.key = 'cashier' and rp.permission_key = 'parcels.view';

create or replace function public.neighbourhood_registration_status(p_district uuid default null)
returns table (id uuid, code text, name_so text, name_en text, district_id uuid, district_so text, district_en text,
               has_boundary boolean, partial bigint, open_applications bigint, registered bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('parcels.yet_to_register') then
    perform private.raise_app_error('PERMISSION_DENIED', 'parcels.yet_to_register');
  end if;
  return query
    select n.id, n.code, n.name_so, n.name_en, d.id, d.name_so, d.name_en, coalesce(n.has_geom, false),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
           (select count(*) from public.applications a
             where a.neighbourhood_id = n.id and a.status not in ('approved', 'rejected', 'cancelled')),
           (select count(*) from public.parcels p
             where p.neighbourhood_id = n.id and p.deleted_at is null and p.status in ('registered', 'disputed'))
      from public.neighbourhoods n
      join public.districts d on d.id = n.district_id
     where n.deleted_at is null and d.deleted_at is null
       and public.can_access_district(d.id) and (p_district is null or d.id = p_district)
     order by d.name_en, n.code;
end;
$$;
