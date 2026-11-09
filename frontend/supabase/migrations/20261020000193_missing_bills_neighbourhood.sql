-- "Check missing bills" also returns the neighbourhood code, so the list can show the full house number
-- (neighbourhood code + house number) like every other page.

do $do$
declare
  d text := pg_get_functiondef('public.invoice_missing()'::regprocedure);
begin
  d := replace(d, $a$    select p.id, p.pun, p.house_no, p.status,$a$,
                  $b$    select p.id, p.pun, p.house_no, p.status,
           (select n.code from public.neighbourhoods n where n.id = p.neighbourhood_id) as neighbourhood_code,$b$);
  d := replace(d, $a$'house_no', w.house_no, 'owners'$a$, $b$'house_no', w.house_no, 'neighbourhood_code', w.neighbourhood_code, 'owners'$b$);
  if position('neighbourhood_code' in d) = 0 or position($x$'neighbourhood_code', w.neighbourhood_code$x$ in d) = 0 then
    raise exception 'invoice_missing: text not found';
  end if;
  execute d;
end;
$do$;
