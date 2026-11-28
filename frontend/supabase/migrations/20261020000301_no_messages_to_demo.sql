-- Made-up DEMO owners (parties.legacy_id 'DEMO-…', added 2026-11-28 for testing) are never sent a message: no SMS,
-- WhatsApp or email is queued for them, and Messages → Write a message leaves them out.

/** A made-up owner added for testing. */
create or replace function private.is_demo_party(p_party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select legacy_id like 'DEMO-%' from public.parties where id = p_party), false);
$$;
revoke all on function private.is_demo_party(uuid) from public, anon, authenticated;

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('private.queue_message(text,text,uuid,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
  n := replace(d, $a$  if p_phone is null$a$, $b$  -- Never to a made-up DEMO owner (0301).
  if p_party is not null and private.is_demo_party(p_party) then
    return null;
  end if;
  if p_phone is null$b$);
  if n = d then
    raise exception 'queue_message: anchor not found';
  end if;
  execute n;

  d := pg_get_functiondef('private.compose_recipients(jsonb,text,boolean,boolean,text)'::regprocedure);
  n := replace(d, $a$join public.parties p on p.id = o.party_id and p.deleted_at is null$a$,
                  $b$join public.parties p on p.id = o.party_id and p.deleted_at is null and coalesce(p.legacy_id, '') not like 'DEMO-%'$b$);
  if n = d then
    raise exception 'compose_recipients: anchor not found';
  end if;
  execute n;
end;
$do$;
