-- Owner names always start each word with a capital letter ("izuddin musa" → "Izuddin Musa"), however the owner was
-- saved: the full owner form, the quick name in the field, the parcel edit, imports. Same rule as the owner form: the
-- first letter after the start, a space or a dash is made capital; the rest is left as typed (McDonald stays McDonald).
-- Covers the full name, mother's name and next of kin; existing owners (and the names on their documents) updated now.

create or replace function private.capitalize_name(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := '';
  v_prev text := ' ';
  c text;
begin
  if p is null then
    return null;
  end if;
  foreach c in array regexp_split_to_array(p, '') loop
    v_out := v_out || case when v_prev ~ '[\s-]' then upper(c) else c end;
    v_prev := c;
  end loop;
  return v_out;
end;
$$;

create or replace function private.parties_capitalize_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := private.capitalize_name(new.full_name);
  new.mother_name := private.capitalize_name(new.mother_name);
  if new.next_of_kin ? 'name' and jsonb_typeof(new.next_of_kin -> 'name') = 'string' then
    new.next_of_kin := jsonb_set(new.next_of_kin, '{name}', to_jsonb(private.capitalize_name(new.next_of_kin ->> 'name')));
  end if;
  return new;
end;
$$;

drop trigger if exists capitalize_names on public.parties;
create trigger capitalize_names before insert or update of full_name, mother_name, next_of_kin on public.parties
  for each row execute function private.parties_capitalize_names();

-- Owners already saved, and the names on their certificates and ID cards.
update public.parties
   set full_name = full_name
 where full_name is distinct from private.capitalize_name(full_name)
    or mother_name is distinct from private.capitalize_name(mother_name)
    or (next_of_kin ->> 'name') is distinct from private.capitalize_name(next_of_kin ->> 'name');

update public.issued_documents d
   set snapshot = d.snapshot
     || jsonb_build_object('owners', (select coalesce(jsonb_agg(o || jsonb_build_object('full_name', private.capitalize_name(o ->> 'full_name'),
                                                                                        'mother_name', private.capitalize_name(o ->> 'mother_name'))), '[]'::jsonb)
                                        from jsonb_array_elements(d.snapshot -> 'owners') o))
     || case when d.snapshot ? 'holder' and jsonb_typeof(d.snapshot -> 'holder') = 'object'
             then jsonb_build_object('holder', (d.snapshot -> 'holder') || jsonb_build_object('full_name', private.capitalize_name(d.snapshot -> 'holder' ->> 'full_name'),
                                                                                              'mother_name', private.capitalize_name(d.snapshot -> 'holder' ->> 'mother_name')))
             else '{}'::jsonb end
 where jsonb_typeof(d.snapshot -> 'owners') = 'array'
   and exists (select 1 from jsonb_array_elements(d.snapshot -> 'owners') o
                where (o ->> 'full_name') is distinct from private.capitalize_name(o ->> 'full_name')
                   or (o ->> 'mother_name') is distinct from private.capitalize_name(o ->> 'mother_name'));
