-- Points of sale: one office cash desk per district. A district that already has one (switched on) can't get a
-- second. (Field desks, for collectors going house to house, and the online desk are not counted.)

do $$
declare
  d text := pg_get_functiondef('public.pos_save(uuid,jsonb)'::regprocedure);
  a text := '  if v_district is null then
    perform private.raise_app_error(''VALIDATION'', ''pos_district'');
  end if;';
  b text := '  if exists (select 1 from public.points_of_sale s where upper(s.code) = v_code and (p_id is null or s.id <> p_id)) then
    perform private.raise_app_error(''CONFLICT'', ''pos_code_taken'');
  end if;
' || a || '
  if v_kind = ''cashier'' and coalesce((p ->> ''active'')::boolean, true)
     and exists (select 1 from public.points_of_sale s where s.district_id = v_district and s.active and s.kind = ''cashier''
                   and (p_id is null or s.id <> p_id)) then
    perform private.raise_app_error(''CONFLICT'', ''pos_district_taken'');
  end if;';
begin
  if position(a in d) = 0 then
    raise exception 'pos_save: anchor not found';
  end if;
  execute replace(d, a, b);
end $$;

create unique index if not exists points_of_sale_one_per_district on public.points_of_sale (district_id)
  where active and kind = 'cashier' and district_id is not null;
