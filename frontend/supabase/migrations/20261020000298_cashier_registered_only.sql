-- District cashiers only deal with registered land (owner's request, 2026-11-28): the To collect list leaves out bills
-- of land not registered yet (partial: draft, surveyed, verified), and taking a payment at the desk for such land is
-- refused with CONFLICT cashier_partial. The land is registered first; its bills are then collected as usual.

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.cashier_to_collect(uuid)'::regprocedure);
  n := replace(d, $a$p.status in ('registered', 'disputed', 'draft', 'surveyed', 'verified')$a$, $b$p.status in ('registered', 'disputed')$b$);
  if n = d then
    raise exception 'cashier_to_collect: anchor not found';
  end if;
  execute n;

  d := pg_get_functiondef('public.cashier_take_payment(uuid, jsonb)'::regprocedure);
  n := replace(d, $a$  -- The same parcel paying the same amount moments ago is most likely a double entry.$a$,
                  $b$  -- Land not registered yet is not paid at the desk (0298): it is registered first.
  if v_parcel.status in ('draft', 'surveyed', 'verified') then
    perform private.raise_app_error('CONFLICT', 'cashier_partial');
  end if;
  -- The same parcel paying the same amount moments ago is most likely a double entry.$b$);
  if n = d then
    raise exception 'cashier_take_payment: anchor not found';
  end if;
  execute n;
end;
$do$;
