-- Approving payments: the Super Admin may approve payments they took themselves (e.g. testing the desk alone). Everyone
-- else still never checks their own takings (maker-checker), as before.

do $do$
declare
  d text := pg_get_functiondef('public.payment_verify(uuid[],text)'::regprocedure);
begin
  d := replace(d, $a$    perform private.assert_maker_checker(v.created_by);$a$,
                  $b$    if not private.user_grants_all(auth.uid()) then
      perform private.assert_maker_checker(v.created_by);
    end if;$b$);
  if position('user_grants_all' in d) = 0 then
    raise exception 'payment_verify: text not found';
  end if;
  execute d;
end;
$do$;
