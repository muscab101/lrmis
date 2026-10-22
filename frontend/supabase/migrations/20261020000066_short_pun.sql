-- Shorter PUNs: the parcel number keeps one leading zero at most (BN-01-01-01 … BN-01-01-09,
-- BN-01-01-10, BN-01-01-100) instead of six digits (BN-01-01-000001). Existing PUNs are renumbered
-- and the PUN inside existing documents' snapshots follows, so certificates and the verify page match.

/** {serial:N} pads to at least N digits; longer numbers are kept whole (lpad alone would cut them). */
create or replace function private.format_serial(p_format text, p_district text, p_neighbourhood text, p_serial int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_format;
  m text[];
begin
  v := replace(replace(v, '{district}', p_district), '{neighbourhood}', coalesce(p_neighbourhood, ''));
  m := regexp_match(v, '\{serial:(\d+)\}');
  if m is not null then
    v := replace(v, '{serial:' || m[1] || '}', lpad(p_serial::text, greatest(m[1]::int, length(p_serial::text)), '0'));
  else
    v := replace(v, '{serial}', p_serial::text);
  end if;
  return v;
end;
$$;

update public.settings set value = to_jsonb('BN-{district}-{neighbourhood}-{serial:2}'::text)
 where key = 'registration.pun_format' and value #>> '{}' = 'BN-{district}-{neighbourhood}-{serial:6}';

do $$
declare
  r record;
begin
  for r in
    select id, pun as old_pun,
           regexp_replace(pun, '-(\d+)$', '') || '-' ||
             lpad(((regexp_match(pun, '-(\d+)$'))[1]::bigint)::text, greatest(2, length(((regexp_match(pun, '-(\d+)$'))[1]::bigint)::text)), '0') as new_pun
      from public.parcels
     where pun ~ '-\d{3,}$'
  loop
    continue when r.new_pun = r.old_pun;
    update public.parcels set pun = r.new_pun where id = r.id;
    -- Snapshots name the parcel and its neighbours by PUN; quoted so BN-01-01-01 can't match BN-01-01-010.
    update public.issued_documents
       set snapshot = replace(snapshot::text, '"' || r.old_pun || '"', '"' || r.new_pun || '"')::jsonb
     where snapshot::text like '%"' || r.old_pun || '"%';
  end loop;
end $$;
