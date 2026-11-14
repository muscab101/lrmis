-- Applications: only transfers, certificates and accounting. Land changes, demolitions and message campaigns are
-- approved on their own pages again.
do $$
declare
  d text := pg_get_functiondef('public.approvals_inbox()'::regprocedure);
  s int;
  e int;
begin
  s := position('  if public.has_permission(''parcels.approve'') then' in d);
  e := position('  if public.has_permission(''transfers.approve'') then' in d);
  if s = 0 or e = 0 then
    raise exception 'land sections not found';
  end if;
  -- (includes the demolitions section, which sits between them)
  d := substr(d, 1, s - 1) || substr(d, e);
  s := position('  if public.has_permission(''messages.approve'') then' in d);
  e := position('  return jsonb_build_object(''items''' in d);
  if s = 0 or e = 0 then
    raise exception 'messages section not found';
  end if;
  d := substr(d, 1, s - 1) || substr(d, e);
  if position('land_change' in d) > 0 or position('demolition' in d) > 0 or position('campaign' in d) > 0 then
    raise exception 'still there';
  end if;
  execute d;
end $$;
