-- No neighbourhood inside or over another (owner's request, 2026-11-23): a neighbourhood's drawn border may not cover
-- any part of another neighbourhood's border (more than 1 m², so borders that only touch are fine). Saving one that does
-- is refused with CONFLICT "neighbourhood_overlap: <code of the neighbourhood it covers most>".

create or replace function public.locations_set_geometry(p_level text, p_id uuid, p_geojson jsonb)
returns jsonb
language plpgsql
set search_path = 'extensions'
as $$
declare
  v_kind text := case p_level when 'streets' then 'line' when 'facilities' then 'point' else 'polygon' end;
  v_geom geometry;
  v_count int;
  v_other text;
begin
  if p_level not in ('regions', 'districts', 'sections', 'sectors', 'neighbourhoods', 'streets', 'facilities') then
    perform private.raise_app_error('VALIDATION', 'level');
  end if;
  perform private.assert_permission('locations.update');
  v_geom := private.geojson_to_geometry(p_geojson, v_kind);

  -- A neighbourhood may not lie in or over another one.
  if p_level = 'neighbourhoods' and v_geom is not null then
    select n.code into v_other
      from public.neighbourhoods n
     where n.id <> p_id and n.deleted_at is null and n.geom is not null
       and st_intersects(n.geom, v_geom)
       and st_area(st_intersection(n.geom, v_geom)::geography) > 1
     order by st_area(st_intersection(n.geom, v_geom)::geography) desc
     limit 1;
    if v_other is not null then
      perform private.raise_app_error('CONFLICT', 'neighbourhood_overlap: ' || v_other);
    end if;
  end if;

  execute format('update public.%I set geom = $1 where id = $2 and deleted_at is null', p_level)
    using v_geom, p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform private.raise_app_error('NOT_FOUND', p_level);
  end if;

  return jsonb_build_object(
    'area_m2', case when v_kind = 'polygon' then round(st_area(v_geom::geography)::numeric, 1) end,
    'length_m', case when v_kind = 'line' then round(st_length(v_geom::geography)::numeric, 1) end,
    'bbox', st_asgeojson(st_envelope(v_geom))::jsonb
  );
end;
$$;
