-- Applications: a cashier shift opens Payments → Shifts (where shifts are approved); a cash count opens that cashier's
-- day on the reconcile page (it needs the cashier and the day).
do $$
declare
  d text := pg_get_functiondef('public.approvals_inbox()'::regprocedure);
  a1 text := '''at'', s.closed_at, ''href'', ''/collections/reconcile'', ''district_id'', s.district_id,';
  b1 text := '''at'', s.closed_at, ''href'', ''/payments?tab=shifts'', ''district_id'', s.district_id,';
  a2 text := '''at'', c.prepared_at, ''href'', ''/collections/reconcile'', ''district_id'', c.district_id,';
  b2 text := '''at'', c.prepared_at, ''href'', ''/collections/reconcile?cashier='' || c.cashier_id || ''&date='' || c.business_date, ''district_id'', c.district_id,';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'approvals_inbox: links not found';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;
