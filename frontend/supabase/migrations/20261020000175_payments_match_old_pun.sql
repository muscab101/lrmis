-- Mobile money: a customer who still types their land's old PUN (before the short PUN, 2026-11-07) as the payment
-- reference is matched to their land, not left unmatched.
do $do$
declare
  d text := pg_get_functiondef('public.webhook_ingest(text,text,boolean,jsonb,jsonb)'::regprocedure);
  a text := $a$where pun = upper(trim(p_event ->> 'reference')) and deleted_at is null$a$;
  b text := $b$where (pun = upper(trim(p_event ->> 'reference')) or pun_old = upper(trim(p_event ->> 'reference'))) and deleted_at is null$b$;
begin
  if position(a in d) = 0 then
    raise exception 'webhook_ingest: PUN match not found';
  end if;
  execute replace(d, a, b);
end;
$do$;
