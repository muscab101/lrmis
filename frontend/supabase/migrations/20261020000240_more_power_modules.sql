-- Powers for the parts of the system that had none of their own (they borrowed another part's power, or were open to
-- all staff): Apartments, Building managers, Incomplete, Points of sale, Staff chat, Assistant and Verify. Each now
-- has its own row on Admin → Roles and a user's Powers tab. Nobody loses access: each new power is given to the roles
-- (and per-user changes) that had the power it borrowed.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('apartments.view', 'apartments', 'view', true, 'See apartment buildings and their flats', 'Arag dhismayaasha guryaha iyo guryahooda', 400),
       ('apartments.update', 'apartments', 'update', true, 'Set a building''s manager and extra areas', 'Dooro maamulaha dhismaha iyo meelaha dheeraadka ah', 401),
       ('managers.view', 'managers', 'view', true, 'See building managers', 'Arag maamulayaasha dhismayaasha', 402),
       ('incomplete.view', 'incomplete', 'view', true, 'See the Incomplete page', 'Arag bogga Aan dhammaystirnayn', 403),
       ('points_of_sale.view', 'points_of_sale', 'view', true, 'See points of sale', 'Arag goobaha lacag bixinta', 404),
       ('points_of_sale.update', 'points_of_sale', 'update', true, 'Add and change points of sale', 'Ku dar oo beddel goobaha lacag bixinta', 405),
       ('chat.view', 'chat', 'view', true, 'Use staff chat', 'Isticmaal wada-sheekaysiga shaqaalaha', 406),
       ('assistant.view', 'assistant', 'view', true, 'Use the assistant', 'Isticmaal kaaliyaha', 407),
       ('verify.view', 'verify', 'view', true, 'Check certificates and ID cards', 'Hubi shahaadooyinka iyo kaararka', 408)
on conflict (key) do nothing;

-- Who already had it: the new power follows the power the page used before (null: every role).
create temporary table power_from (new_key text, old_key text) on commit drop;
insert into power_from values
  ('apartments.view', 'parcels.view'),
  ('apartments.update', 'parcels.update'),
  ('apartments.update', 'valuation.update'),
  ('managers.view', 'owners.view'),
  ('incomplete.view', 'dashboard.view'),
  ('points_of_sale.view', 'payments.view'),
  ('points_of_sale.update', 'settings.update'),
  ('chat.view', null),
  ('assistant.view', null),
  ('verify.view', null);

insert into public.role_permissions (role_id, permission_key)
select distinct r.id, f.new_key
  from public.roles r join power_from f on true
 where not r.grants_all
   and (f.old_key is null or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = f.old_key))
on conflict do nothing;

update public.roles r
   set default_permissions = array(select distinct x from unnest(r.default_permissions || array(
         select f.new_key from power_from f where f.old_key is null or f.old_key = any (r.default_permissions))) x)
 where not r.grants_all;

-- A power given to or taken from one user carries over the same way.
insert into public.user_permission_overrides (user_id, permission_key, allow, created_by)
select o.user_id, f.new_key, bool_or(o.allow), (array_agg(o.created_by))[1]
  from public.user_permission_overrides o join power_from f on f.old_key = o.permission_key
 group by o.user_id, f.new_key
on conflict do nothing;

-- The apartment and point-of-sale actions accept the new powers too.
do $$
declare
  f text;
  d text;
  a text := 'if not (public.has_permission(''parcels.update'') or public.has_permission(''valuation.update'')) then';
  b text := 'if not (public.has_permission(''apartments.update'') or public.has_permission(''parcels.update'') or public.has_permission(''valuation.update'')) then';
  pa text := 'perform private.assert_permission(''settings.update'');';
  pb text := 'if not (public.has_permission(''points_of_sale.update'') or public.has_permission(''settings.update'')) then
    perform private.raise_app_error(''PERMISSION_DENIED'', ''points_of_sale.update'');
  end if;';
begin
  foreach f in array array['public.building_manager_set(uuid,uuid)', 'public.building_area_save(uuid,uuid,jsonb)', 'public.building_area_remove(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(a in d) = 0 then
      raise exception '%: check not found', f;
    end if;
    execute replace(d, a, b);
  end loop;
  foreach f in array array['public.pos_save(uuid,jsonb)', 'public.pos_delete(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(pa in d) = 0 then
      raise exception '%: check not found', f;
    end if;
    execute replace(d, pa, pb);
  end loop;
end $$;
