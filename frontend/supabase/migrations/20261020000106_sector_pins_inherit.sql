-- ============================================================================
-- 0106 Every sector on the map: a sector without its own point takes its section's point
-- (flagged `inherited`), so all 395 Banaadir sectors get a pin. Not copied into
-- sectors.point, so correcting a section's point moves its sectors too.
-- ============================================================================

create or replace function public.location_pins()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(f), '[]'::jsonb))
    from (
      select jsonb_build_object(
               'type', 'Feature',
               'geometry', extensions.st_asgeojson(s.point)::jsonb,
               'properties', jsonb_build_object(
                 'id', s.id, 'level', 'section', 'code', s.code, 'name_so', s.name_so, 'name_en', s.name_en,
                 'district_id', s.district_id, 'district_name_so', d.name_so,
                 'confidence', s.point_confidence, 'source', s.point_source)) as f
        from public.sections s
        join public.districts d on d.id = s.district_id
       where s.point is not null and s.deleted_at is null
      union all
      select jsonb_build_object(
               'type', 'Feature',
               'geometry', extensions.st_asgeojson(coalesce(t.point, s.point))::jsonb,
               'properties', jsonb_build_object(
                 'id', t.id, 'level', 'sector', 'name_so', t.name_so, 'name_en', t.name_en,
                 'section_id', t.section_id, 'district_id', t.district_id, 'district_name_so', d.name_so,
                 'inherited', t.point is null,
                 'confidence', coalesce(t.point_confidence, s.point_confidence),
                 'source', coalesce(t.point_source, 'inherited from section ' || s.name_so)))
        from public.sectors t
        join public.sections s on s.id = t.section_id
        join public.districts d on d.id = t.district_id
       where coalesce(t.point, s.point) is not null and t.deleted_at is null
    ) pins;
$$;
