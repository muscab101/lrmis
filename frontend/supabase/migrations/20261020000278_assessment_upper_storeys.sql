-- The yearly valuation counts upper storeys (owner's report, 2026-11-23): a one-owner storey building's bill has
-- area × building price + storeys × area × Upper Floors price (0272), but the parcel's "Valuation and tax" calculation
-- and an issued assessment only had the land part. Upper storeys now go in the buildings amount (they are building
-- floors) and the total, with their own line for the screen. The yearly run uses an issued assessment's total alone,
-- so nothing is counted twice.

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('private.compute_assessment(uuid,integer)'::regprocedure);
  n := regexp_replace(d, $re$(where b\.parcel_id = p_parcel and b\.deleted_at is null;)$re$, $rp$\1
  -- A storey building's upper storeys (none for flats, units or land without storeys).
  v_buildings := v_buildings + private.upper_storeys_amount(p_parcel);$rp$);
  n := regexp_replace(n, $re$('service_charge', v_service,)$re$, $rp$'upper_storeys', coalesce(v_p.upper_storeys, 0),
    'upper_storeys_amount', private.upper_storeys_amount(p_parcel), 'upper_storeys_line', private.upper_storeys_line(p_parcel),
    \1$rp$);
  if n = d or position('v_buildings := v_buildings + private.upper_storeys_amount' in n) = 0 or position('''upper_storeys_amount''' in n) = 0 then
    raise exception 'compute_assessment: anchor not found';
  end if;
  execute n;
end;
$do$;
