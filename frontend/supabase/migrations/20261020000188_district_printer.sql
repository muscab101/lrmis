-- Each district prints on its own printer: a certificate or ID card of Kaaraan goes only to a printer of Kaaraan.
-- "Print now" sends a document straight to its district's printer (no choosing): the one online first, then the one at
-- the person's own point of sale, then any of that district's printers.

do $do$
declare
  d text := pg_get_functiondef('public.document_send_to_printer(uuid,uuid,text)'::regprocedure);
begin
  d := replace(d, $a$  if exists (select 1 from public.printer_queue q where q.document_id = p_id and q.status in ('queued', 'printing')) then$a$,
                  $b$  -- Only the document's own district's printer.
  if v.district_id is not null and v_printer.district_id is distinct from v.district_id then
    perform private.raise_app_error('CONFLICT', 'printer_wrong_district');
  end if;
  if exists (select 1 from public.printer_queue q where q.document_id = p_id and q.status in ('queued', 'printing')) then$b$);
  if position('printer_wrong_district' in d) = 0 then
    raise exception 'document_send_to_printer: queue check not found';
  end if;
  execute d;
end;
$do$;

create or replace function public.document_print_now(p_id uuid, p_locale text default 'so')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
  v_my_pos uuid := (select pr.point_of_sale_id from public.profiles pr where pr.user_id = auth.uid());
  v_printer public.printers;
begin
  perform private.assert_permission('certificates.print');
  select * into v from public.issued_documents where id = p_id;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  select p.* into v_printer from public.printers p
   where p.active and p.district_id = v.district_id
     and exists (select 1 from public.printer_keys k where k.printer_id = p.id)
   order by coalesce(p.agent_last_seen > now() - interval '2 minutes', false) desc,
            (v_my_pos is not null and p.pos_id = v_my_pos) desc,
            p.name
   limit 1;
  if v_printer.id is null then
    perform private.raise_app_error('CONFLICT', 'no_district_printer');
  end if;
  return jsonb_build_object(
    'job', public.document_send_to_printer(p_id, v_printer.id, p_locale),
    'printer', v_printer.name,
    'online', coalesce(v_printer.agent_last_seen > now() - interval '2 minutes', false));
end;
$$;
revoke all on function public.document_print_now(uuid, text) from public, anon;
grant execute on function public.document_print_now(uuid, text) to authenticated;

-- For one document, the printer list shows only its own district's printers.
drop function if exists public.printer_choices();
create function public.printer_choices(p_district uuid default null)
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
     and (p_district is null or p.district_id = p_district)
   order by (v_my_pos is not null and p.pos_id = v_my_pos) desc, p.name;
end;
$$;
revoke all on function public.printer_choices(uuid) from public, anon;
grant execute on function public.printer_choices(uuid) to authenticated;
