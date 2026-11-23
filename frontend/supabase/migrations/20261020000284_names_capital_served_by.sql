-- System users' names start with a capital letter, and printed papers say who served (owner's request, 2026-11-23).
-- 1. Every word of a user's full name starts with a capital (the rest is kept as typed: "abdi mcdonald" → "Abdi
--    Mcdonald" would be wrong, so only the first letter of each word changes). Saved names are fixed too.
-- 2. Receipts, invoices, certificates and ID cards printed by the print program carry "served by": the cashier who
--    took the payment for a receipt, else the staff member who sent the paper to the printer.

/** Each word with a capital first letter; spaces tidied. */
create or replace function private.cap_words(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null else
    (select string_agg(upper(left(w, 1)) || substr(w, 2), ' ' order by o)
       from regexp_split_to_table(trim(regexp_replace(p, '\s+', ' ', 'g')), ' ') with ordinality t(w, o)
      where w <> '')
  end;
$$;

create or replace function private.profiles_cap_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := coalesce(private.cap_words(new.full_name), new.full_name);
  return new;
end;
$$;

drop trigger if exists cap_name on public.profiles;
create trigger cap_name before insert or update of full_name on public.profiles
  for each row execute function private.profiles_cap_name();

update public.profiles set full_name = private.cap_words(full_name)
 where full_name is not null and full_name <> '' and full_name is distinct from private.cap_words(full_name);

/** A staff member's full name (for "served by" on printed papers); null for anyone else. */
create or replace function private.staff_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(trim(p.full_name), '') from public.profiles p where p.user_id = p_user and p.kind = 'staff';
$$;

revoke all on function private.staff_name_of(uuid) from public, anon, authenticated;

/** The same, for the app's print pages (a receipt's cashier, shown to the payer too). */
create or replace function public.staff_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is not null then private.staff_name_of(p_user) end;
$$;

revoke all on function public.staff_name(uuid) from public, anon;
grant execute on function public.staff_name(uuid) to authenticated;

-- The print program's papers say who served.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.agent_job_document(text)'::regprocedure);
  n := replace(d, $a$return (select jsonb_build_object('receipt', jsonb_build_object($a$,
                  $b$return (select jsonb_build_object('served_by', private.staff_name_of(pm.created_by), 'receipt', jsonb_build_object($b$);
  n := replace(n, $a$return jsonb_build_object('invoice', jsonb_build_object($a$,
                  $b$return jsonb_build_object('served_by', private.staff_name_of(v_job.requested_by), 'invoice', jsonb_build_object($b$);
  n := replace(n, $a$  return jsonb_build_object(
    'doc', to_jsonb(v)$a$, $b$  return jsonb_build_object(
    'served_by', private.staff_name_of(v_job.requested_by),
    'doc', to_jsonb(v)$b$);
  if n = d or (length(n) - length(replace(n, 'served_by', ''))) / length('served_by') <> 3 then
    raise exception 'agent_job_document: anchor not found';
  end if;
  execute n;
end;
$do$;
