-- 4-corner drawing (owner's request, 2026-11-23): a Map power that lets staff draw land by its four corners with a
-- pointer fixed in the middle of the map: move the map until the pointer sits on a corner, press Add corner, four
-- times, and the shape closes. It shows on the survey map and the remap map. The roles that already fix boundaries on
-- the map (map.edit_geometry: surveyors, GIS officers) get it; admins have every power anyway.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('map.draw_corners', 'map', 'draw_corners', true, 'Draw land by its 4 corners with the centre pointer',
        'Ku sawir dhulka afartiisa gees adigoo isticmaalaya tilmaamaha bartamaha', 251)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select distinct rp.role_id, 'map.draw_corners'
  from public.role_permissions rp join public.roles r on r.id = rp.role_id
 where rp.permission_key = 'map.edit_geometry' and not r.grants_all
on conflict do nothing;

update public.roles r
   set default_permissions = array(select distinct x from unnest(r.default_permissions || array['map.draw_corners']) x)
 where not r.grants_all and 'map.edit_geometry' = any (r.default_permissions);
