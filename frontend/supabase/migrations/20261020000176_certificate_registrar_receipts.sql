-- Certificate fixes found by the 15-house test (2026-11-08):
-- 1. The registrar named on a certificate is the one who registered the land. A certificate made by itself when the
--    bills were paid named whoever recorded the payment (a finance officer).
-- 2. A receipt on the certificate shows the whole receipt. It was made at the moment the bills became paid, before
--    every part of the payment was written down, so a $66 receipt could show $54.

do $do$
declare
  d text := pg_get_functiondef('private.certificate_snapshot(uuid)'::regprocedure);
  a text := $a$'registrar', (select pr.full_name from public.profiles pr where pr.user_id = auth.uid()))$a$;
  b text := $b$'registrar', coalesce((select pr.full_name from public.profiles pr where pr.user_id = p.registered_by),
                         (select pr.full_name from public.profiles pr where pr.user_id = auth.uid())))$b$;
begin
  if position(a in d) = 0 then
    raise exception 'certificate_snapshot: registrar not found';
  end if;
  execute replace(d, a, b);
end;
$do$;

do $do$
declare
  d text := pg_get_functiondef('private.certificate_year_facts(uuid,integer)'::regprocedure);
  a text := $a$(select p.receipt_no, p.received_at, sum(a.amount) as amount$a$;
  b text := $b$(select p.receipt_no, p.received_at, max(p.amount_base) as amount$b$;
begin
  if position(a in d) = 0 then
    raise exception 'certificate_year_facts: receipt amount not found';
  end if;
  execute replace(d, a, b);
end;
$do$;

-- Certificates already made: the land's registrar, and whole receipts.
update public.issued_documents d
   set snapshot = d.snapshot
     || jsonb_build_object('registrar', coalesce((select pr.full_name from public.parcels p join public.profiles pr on pr.user_id = p.registered_by
                                                   where p.id = d.parcel_id), d.snapshot ->> 'registrar'))
     || case when d.snapshot ? 'receipts'
             then jsonb_build_object('receipts', private.certificate_year_facts(d.parcel_id, (d.snapshot ->> 'tax_year')::int) -> 'receipts')
             else '{}'::jsonb end
 where d.type = 'certificate';
