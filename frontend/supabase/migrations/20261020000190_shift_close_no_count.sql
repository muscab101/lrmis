-- Cashiers no longer count the drawer: closing a shift without a count records the cash as exactly what was taken
-- (counted = expected, no difference). A count can still be given, and is checked as before.

do $do$
declare
  d text := pg_get_functiondef('public.shift_close(uuid,numeric,text)'::regprocedure);
begin
  d := replace(d, $a$  if p_counted is null or p_counted < 0 then$a$, $b$  if p_counted < 0 then$b$);
  d := replace(d,
    $a$  from public.payments where shift_id = p_id and method = 'cash' and status <> 'reversed';
$a$,
    $b$  from public.payments where shift_id = p_id and method = 'cash' and status <> 'reversed';
  -- No count given: the cash is what was taken.
  p_counted := coalesce(p_counted, v_expected);
$b$);
  if position('p_counted := coalesce(p_counted, v_expected)' in d) = 0 or position('p_counted is null or' in d) > 0 then
    raise exception 'shift_close: text not found';
  end if;
  execute d;
end;
$do$;
