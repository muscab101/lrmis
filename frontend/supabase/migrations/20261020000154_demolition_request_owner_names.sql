-- A flats building's owners are on its flats: show them on a request that is still waiting, too.
create or replace function private.demolition_owner_names(p_snapshot jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(x ->> 'full_name', ', ')
    from jsonb_array_elements(coalesce(nullif(p_snapshot -> 'owners', '[]'::jsonb),
         (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements(p_snapshot -> 'units') u, jsonb_array_elements(u -> 'owners') o))) x;
$$;
revoke all on function private.demolition_owner_names(jsonb) from public, anon, authenticated;

create or replace function private.demolition_fill_owner_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_names := coalesce(new.owner_names, private.demolition_owner_names(new.snapshot));
  return new;
end;
$$;
create trigger fill_owner_names before insert on public.demolitions for each row execute function private.demolition_fill_owner_names();
revoke all on function private.demolition_fill_owner_names() from public, anon, authenticated;
