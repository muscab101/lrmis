-- The citizen portal marks land that is not fully registered yet (the parcel still in partial registration, or the
-- owner still a draft) and demolished land, so it can send the citizen to the district office instead of offering to
-- pay. Paying such bills is already refused by payment_intent_create (bill_needs_registered / parcel_demolished).

do $do$
declare
  d text := pg_get_functiondef('public.citizen_overview()'::regprocedure);
begin
  d := replace(d, $a$'id', pc.id, 'pun', pc.pun, 'status', pc.status,$a$,
    $b$'id', pc.id, 'pun', pc.pun, 'status', pc.status,
        'partial', pc.status in ('draft', 'surveyed', 'verified')
                   or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                               where po.parcel_id = pc.id and po.valid_to is null and po.party_id in (select id from me)
                                 and pa.registered_at is null),
        'demolished', pc.building_state = 'demolished',$b$);
  if position($x$'partial'$x$ in d) = 0 then
    raise exception 'citizen_overview: text not found';
  end if;
  execute d;
end;
$do$;
