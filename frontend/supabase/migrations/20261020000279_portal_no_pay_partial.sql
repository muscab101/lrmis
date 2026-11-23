-- No online payment for land still in partial registration (owner's request, 2026-11-23): like demolished land, a
-- bill on partial land (draft, surveyed or verified) cannot be paid from the citizen portal or a pay link. Staff who
-- take payments in that district (payments.create) still can, so the cashier flow is unchanged.

do $do$
declare
  d text;
  n text;
begin
  -- One bill (portal, or a pay link's token).
  d := pg_get_functiondef('public.payment_intent_create(uuid,text,text,text)'::regprocedure);
  n := regexp_replace(d, $re$(perform private\.raise_app_error\('CONFLICT', 'parcel_demolished'\);\s+end if;)$re$, $rp$\1
  if (p_token is not null or not (public.has_permission('payments.create') and public.can_access_district(v_inv.district_id)))
     and exists (select 1 from public.parcels p where p.id = v_inv.parcel_id and p.status in ('draft', 'surveyed', 'verified')) then
    perform private.raise_app_error('CONFLICT', 'parcel_partial');
  end if;$rp$);
  if n = d or position('parcel_partial' in n) = 0 then
    raise exception 'payment_intent_create: anchor not found';
  end if;
  execute n;

  -- Several bills at once (the portal's Pay all).
  d := pg_get_functiondef('public.payment_intent_create_many(uuid[],text,text)'::regprocedure);
  n := replace(d, 'select i.*, p.pun, p.building_state', 'select i.*, p.pun, p.building_state, p.status as parcel_status');
  n := regexp_replace(n, $re$(perform private\.raise_app_error\('CONFLICT', 'parcel_demolished'\);\s+end if;)$re$, $rp$\1
    if r.parcel_status in ('draft', 'surveyed', 'verified')
       and not (public.has_permission('payments.create') and public.can_access_district(r.district_id)) then
      perform private.raise_app_error('CONFLICT', 'parcel_partial');
    end if;$rp$);
  if n = d or position('parcel_partial' in n) = 0 or position('p.status as parcel_status' in n) = 0 then
    raise exception 'payment_intent_create_many: anchor not found';
  end if;
  execute n;
end;
$do$;
