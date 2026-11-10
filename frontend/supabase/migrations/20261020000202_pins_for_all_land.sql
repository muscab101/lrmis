-- The map shows land as pins only (no shapes): every parcel gets a pin, not just registered ones, and partial land
-- (not registered yet) is marked so its pin can have its own colour.

do $do$
declare
  d text := pg_get_functiondef('public.parcel_tile(integer,integer,integer)'::regprocedure);
begin
  d := replace(d, $a$           p.building_state = 'demolished' as demolished
    from public.parcels p
    where p.deleted_at is null and p.parent_id is null and p.status = 'registered' and p.geom is not null$a$,
                  $b$           p.building_state = 'demolished' as demolished,
           p.status in ('draft', 'surveyed', 'verified') as partial
    from public.parcels p
    where p.deleted_at is null and p.parent_id is null and p.status <> 'archived' and p.geom is not null$b$);
  if position('as partial' in d) = 0 then
    raise exception 'parcel_tile: text not found';
  end if;
  execute d;
end;
$do$;
