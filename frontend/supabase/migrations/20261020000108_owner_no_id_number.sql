-- ============================================================================
-- 0108 "N/A" as an owner's ID number: the person has no ID document.
--
-- Staff type N/A in Document number for anyone without an ID. It is stored as
-- no ID (number and type empty), so it is never a duplicate of another owner
-- and any number of owners can use it. Duplicate checks and the unique index
-- already skip empty ID numbers.
-- ============================================================================

create or replace function private.normalise_id_number(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when upper(regexp_replace(coalesce(p, ''), '[\s.]', '', 'g')) in ('N/A', 'NA', '') then null
              else upper(regexp_replace(p, '\s', '', 'g')) end;
$$;
