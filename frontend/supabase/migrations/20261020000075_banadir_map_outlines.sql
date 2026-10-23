-- District outlines of the Banadir region, simplified for printing (the back of the property ID card
-- draws the region and marks the holder's district and house).

create or replace function public.banadir_map_outlines()
returns table (code text, name_so text, name_en text, outline jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('certificates.view') or public.has_permission('documents.view')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'certificates.view');
  end if;
  return query
    select d.code, d.name_so, d.name_en,
           extensions.st_asgeojson(extensions.st_simplifypreservetopology(d.geom, 0.0004), 5)::jsonb
      from public.districts d
     where d.deleted_at is null and d.geom is not null
     order by d.code;
end;
$$;

grant execute on function public.banadir_map_outlines() to authenticated;
revoke execute on function public.banadir_map_outlines() from public, anon;
