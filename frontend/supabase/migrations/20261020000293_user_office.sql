-- The office a user works for, worked out from what is already assigned to them (owner's request, 2026-11-27).
-- Nothing new is stored: it reads the user's sections/sectors/neighbourhoods (user_areas), their cash desk
-- (profiles.point_of_sale_id → points_of_sale) and their districts (user_districts, all_districts), in that order:
--   * areas            → level section | sector | neighbourhood (the first one, with how many more)
--   * a cash desk      → level pos: the desk's office (e.g. "Hodan office") and its district
--   * one district     → level district
--   * several          → level districts (the first one, with how many more)
--   * every district / → level head_office
--     no assignment
-- Users can't change any of these themselves; only admins with users.update can (existing admin_* functions).

create or replace function public.user_office(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  r record;
  v_all boolean;
begin
  if v_user is null then
    return null;
  end if;
  if v_user <> auth.uid() and not public.has_permission('users.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'users.view');
  end if;

  -- 1. Sections, sectors or neighbourhoods: the narrowest assignment.
  select a.level, count(*) over () as n,
         coalesce(s.code, se.code, nb.code) as code,
         coalesce(s.name_so, se.name_so, nb.name_so) as name_so, coalesce(s.name_en, se.name_en, nb.name_en) as name_en,
         d.name_so as district_so, d.name_en as district_en
    into r
    from public.user_areas a
    left join public.sections s on a.level = 'section' and s.id = a.area_id
    left join public.sectors se on a.level = 'sector' and se.id = a.area_id
    left join public.neighbourhoods nb on a.level = 'neighbourhood' and nb.id = a.area_id
    left join public.districts d on d.id = coalesce(s.district_id, se.district_id, nb.district_id)
   where a.user_id = v_user
   order by case a.level when 'neighbourhood' then 1 when 'sector' then 2 else 3 end, 3
   limit 1;
  if found then
    return jsonb_build_object('level', r.level, 'code', r.code, 'name_so', r.name_so, 'name_en', r.name_en,
                              'district_so', r.district_so, 'district_en', r.district_en, 'more', r.n - 1);
  end if;

  -- 2. A cash desk (point of sale): its office.
  select s.code, s.name, d.name_so as district_so, d.name_en as district_en into r
    from public.profiles p
    join public.points_of_sale s on s.id = p.point_of_sale_id
    left join public.districts d on d.id = s.district_id
   where p.user_id = v_user;
  if found then
    return jsonb_build_object('level', 'pos', 'code', r.code, 'name_so', r.name, 'name_en', r.name,
                              'district_so', r.district_so, 'district_en', r.district_en, 'more', 0);
  end if;

  -- 3. Districts, or every district (head office).
  v_all := private.user_has_all_districts(v_user);
  if not v_all then
    select d.code, d.name_so, d.name_en, count(*) over () as n into r
      from public.user_districts ud join public.districts d on d.id = ud.district_id and d.deleted_at is null
     where ud.user_id = v_user
     order by d.code
     limit 1;
    if found then
      return jsonb_build_object('level', case when r.n > 1 then 'districts' else 'district' end, 'code', r.code,
                                'name_so', r.name_so, 'name_en', r.name_en, 'more', r.n - 1);
    end if;
  end if;
  return jsonb_build_object('level', 'head_office', 'all', v_all, 'more', 0);
end;
$$;

revoke all on function public.user_office(uuid) from public, anon;
grant execute on function public.user_office(uuid) to authenticated;
