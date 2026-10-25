-- ============================================================================
-- 0062 Points of sale (cash desks) and district cashiers.
--
--  * Admins add, edit, switch off and delete cash desks (Admin → Points of
--    sale, settings.update). A desk that was used is switched off instead.
--  * Each district gets a cash desk to start with ("KRN1 · Karaan office").
--  * A cashier's own desk is set on their user page (users.update); it must be
--    in one of the cashier's districts. The cashier desk opens on it.
-- ============================================================================

/** Create (p_id null) or update a cash desk. p: {code, name, district_id, kind, receipt_prefix, active}. */
create function public.pos_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_code text := upper(trim(coalesce(p ->> 'code', '')));
  v_prefix text := upper(trim(coalesce(nullif(p ->> 'receipt_prefix', ''), p ->> 'code', '')));
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'cashier');
  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
begin
  perform private.assert_permission('settings.update');
  if v_code !~ '^[A-Z0-9]{2,12}$' then
    perform private.raise_app_error('VALIDATION', 'pos_code');
  end if;
  if v_prefix !~ '^[A-Z0-9-]{2,16}$' then
    perform private.raise_app_error('VALIDATION', 'pos_prefix');
  end if;
  if length(coalesce(trim(p ->> 'name'), '')) < 2 then
    perform private.raise_app_error('VALIDATION', 'name');
  end if;
  if v_kind not in ('cashier', 'field') then
    perform private.raise_app_error('VALIDATION', 'pos_kind');
  end if;
  if v_district is null then
    perform private.raise_app_error('VALIDATION', 'pos_district');
  end if;
  if p_id is null then
    insert into public.points_of_sale (code, name, district_id, kind, receipt_prefix, active)
    values (v_code, trim(p ->> 'name'), v_district, v_kind, v_prefix, coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    if exists (select 1 from public.points_of_sale where id = p_id and kind = 'online') then
      perform private.raise_app_error('CONFLICT', 'pos_online');
    end if;
    update public.points_of_sale
       set code = v_code, name = trim(p ->> 'name'), district_id = v_district, kind = v_kind,
           receipt_prefix = v_prefix, active = coalesce((p ->> 'active')::boolean, active)
     where id = p_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'point_of_sale');
    end if;
  end if;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'pos_code_taken');
end;
$$;

/** Delete a desk nobody used; one with shifts or payments is switched off. Returns 'deleted' or 'hidden'. */
create function public.pos_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.points_of_sale;
begin
  perform private.assert_permission('settings.update');
  select * into v from public.points_of_sale where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'point_of_sale');
  end if;
  if v.kind = 'online' then
    perform private.raise_app_error('CONFLICT', 'pos_online');
  end if;
  update public.profiles set point_of_sale_id = null where point_of_sale_id = p_id;
  if exists (select 1 from public.cashier_shifts where pos_id = p_id)
     or exists (select 1 from public.payments where pos_id = p_id) then
    update public.points_of_sale set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.points_of_sale where id = p_id;
  return 'deleted';
end;
$$;

/** Give a staff member their own cash desk (null clears it). It must be in one of their districts. */
create function public.admin_set_user_pos(p_user_id uuid, p_pos uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos public.points_of_sale;
begin
  perform private.assert_permission('users.update');
  perform private.assert_can_manage_user(p_user_id, true);
  if p_pos is not null then
    select * into v_pos from public.points_of_sale where id = p_pos and active and kind <> 'online';
    if v_pos.id is null then
      perform private.raise_app_error('NOT_FOUND', 'point_of_sale');
    end if;
    if not private.user_can_access_district(p_user_id, v_pos.district_id) then
      perform private.raise_app_error('VALIDATION', 'pos_not_in_user_districts');
    end if;
  end if;
  update public.profiles set point_of_sale_id = p_pos where user_id = p_user_id;
  perform private.audit('user.set_point_of_sale', 'profiles', p_user_id::text, null, jsonb_build_object('point_of_sale_id', p_pos));
end;
$$;

revoke all on function public.pos_save(uuid, jsonb), public.pos_delete(uuid), public.admin_set_user_pos(uuid, uuid) from public, anon;
grant execute on function public.pos_save(uuid, jsonb), public.pos_delete(uuid), public.admin_set_user_pos(uuid, uuid) to authenticated;

-- One cash desk per district to start with (code from the district's name; e.g. KRN1 · Karaan office).
insert into public.points_of_sale (code, name, district_id, kind, receipt_prefix)
select m.code || '1', d.name_en || ' office', d.id, 'cashier', m.code || '1'
from public.districts d
join (values ('karaan', 'KRN'), ('cabdicasiis', 'CBD'), ('boondheere', 'BDH'), ('dayniile', 'DYN'), ('dharkeenley', 'DHK'),
             ('xamar-jajab', 'XJB'), ('xamar-weyne', 'XWY'), ('hodan', 'HDN'), ('howlwadaag', 'HWD'), ('heliwaa (huriwaa)', 'HLW'),
             ('kaxda', 'KXD'), ('shangaani', 'SHG'), ('shibis', 'SHB'), ('waaberi', 'WBR'), ('wadajir', 'WDJ'),
             ('warta-nabadda', 'WNB'), ('yaaqshiid', 'YQS'), ('gubadley', 'GBD'), ('garasbaaley', 'GRB'), ('daarusalaam', 'DRS'))
     as m(name, code) on lower(d.name_en) = m.name
where d.deleted_at is null
  and not exists (select 1 from public.points_of_sale p where p.district_id = d.id and p.kind = 'cashier')
on conflict (code) do nothing;
