-- After an approved transfer the old owner's certificate is cancelled; the new owner now gets theirs (and their ID
-- card) straight away when nothing is owed, the same way paying a bill issues one. Found by the 15-house test
-- (2026-11-08): the land was left with no valid certificate.

do $do$
declare
  d text := pg_get_functiondef('public.transfer_decide(uuid,boolean,text)'::regprocedure);
  a text := $a$perform private.cancel_parcel_documents(v.parcel_id, 'Ownership transferred: ' || v.number);$a$;
  b text := $b$perform private.cancel_parcel_documents(v.parcel_id, 'Ownership transferred: ' || v.number);
  -- The new owner's certificate and ID card, when the land has nothing owed.
  perform private.try_auto_certificate(v.parcel_id);$b$;
begin
  if position(a in d) = 0 then
    raise exception 'transfer_decide: certificate cancel not found';
  end if;
  execute replace(d, a, b);
end;
$do$;
