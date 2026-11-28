-- Receipt numbers (2026-11-28): next_receipt_no read every receipt of the year to find the highest number, for each
-- payment — slow once there are tens of thousands. It now reads only the highest one through the prefix index
-- (numbers are zero-padded, so the last in text order is the highest); the loop below still skips any number in use.

do $do$
declare
  d text := pg_get_functiondef('private.next_receipt_no(text,int)'::regprocedure);
  a text := $a$  select coalesce(max(nullif(regexp_replace(substr(receipt_no, length(v_base) + 1), '\D', '', 'g'), '')::int), 0) into v_used
    from public.payments where receipt_no like v_base || '%';$a$;
begin
  if position(a in d) = 0 then
    raise exception 'next_receipt_no: anchor not found';
  end if;
  execute replace(d, a, $b$  select coalesce(nullif(regexp_replace(substr(x.receipt_no, length(v_base) + 1), '\D', '', 'g'), '')::int, 0) into v_used
    from (select receipt_no from public.payments
           where receipt_no like v_base || '%' and length(receipt_no) = length(v_base) + 6
           order by receipt_no desc limit 1) x;
  v_used := coalesce(v_used, 0);$b$);
end $do$;
