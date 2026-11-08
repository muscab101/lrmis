-- A printer belongs to a point of sale (an office or cash desk). Adding or editing a printer picks its point of sale;
-- when printing, staff see their own point of sale's printers first. A printer without a district takes its point of
-- sale's district.

alter table public.printers add column if not exists pos_id uuid references public.points_of_sale (id) on delete set null;
create index if not exists printers_pos_idx on public.printers (pos_id);

do $do$
declare
  d text := pg_get_functiondef('public.printer_save(jsonb)'::regprocedure);
begin
  -- Read the point of sale and check it.
  d := replace(d, $a$  v_district uuid := nullif(p ->> 'district_id', '')::uuid;$a$,
                  $b$  v_district uuid := nullif(p ->> 'district_id', '')::uuid;
  v_pos uuid := nullif(p ->> 'pos_id', '')::uuid;$b$);
  d := replace(d, $a$  if v_district is not null and not public.can_access_district(v_district) then$a$,
                  $b$  if v_pos is not null then
    if not exists (select 1 from public.points_of_sale s where s.id = v_pos and s.active) then
      perform private.raise_app_error('VALIDATION', 'pos');
    end if;
    v_district := coalesce(v_district, (select s.district_id from public.points_of_sale s where s.id = v_pos));
  end if;
  if v_district is not null and not public.can_access_district(v_district) then$b$);
  -- Save it.
  d := replace(d, $a$location, department, district_id, created_by)$a$, $b$location, department, district_id, pos_id, created_by)$b$);
  d := replace(d, $a$nullif(trim(coalesce(p ->> 'department', '')), ''), v_district, auth.uid())$a$,
                  $b$nullif(trim(coalesce(p ->> 'department', '')), ''), v_district, v_pos, auth.uid())$b$);
  d := replace(d, $a$department = nullif(trim(coalesce(p ->> 'department', '')), ''), district_id = v_district, updated_at = now()$a$,
                  $b$department = nullif(trim(coalesce(p ->> 'department', '')), ''), district_id = v_district, pos_id = v_pos, updated_at = now()$b$);
  if position('v_pos, auth.uid()' in d) = 0 or position('pos_id = v_pos' in d) = 0 or position($c$'pos'$c$ in d) = 0 then
    raise exception 'printer_save: not all parts were found';
  end if;
  execute d;

  -- The printer list shows each printer's point of sale.
  d := pg_get_functiondef('public.printer_overview()'::regprocedure);
  d := replace(d, $a$p.district_id, p.active, p.agent_last_seen,$a$,
                  $b$p.district_id, p.pos_id, (select s.name from public.points_of_sale s where s.id = p.pos_id) as pos_name, p.active, p.agent_last_seen,$b$);
  if position('pos_name' in d) = 0 then
    raise exception 'printer_overview: printer columns not found';
  end if;
  execute d;
end;
$do$;

-- When printing: each printer's point of sale, and the person's own point of sale's printers first.
drop function public.printer_choices();
create function public.printer_choices()
returns table (id uuid, code text, name text, location text, online boolean, pos_name text, mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_my_pos uuid := (select pr.point_of_sale_id from public.profiles pr where pr.user_id = auth.uid());
begin
  perform private.assert_permission('certificates.print');
  return query
  select p.id, p.code, p.name, p.location, coalesce(p.agent_last_seen > now() - interval '2 minutes', false),
         s.name, (v_my_pos is not null and p.pos_id = v_my_pos)
    from public.printers p
    left join public.points_of_sale s on s.id = p.pos_id
   where p.active and exists (select 1 from public.printer_keys k where k.printer_id = p.id)
     and (p.district_id is null or public.can_access_district(p.district_id))
   order by (v_my_pos is not null and p.pos_id = v_my_pos) desc, p.name;
end;
$$;
revoke all on function public.printer_choices() from public, anon;
grant execute on function public.printer_choices() to authenticated;
