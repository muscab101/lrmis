-- The land form asks the owner type too (2026-11-27), since registering now needs it (0294): field_land_create takes
-- p.owner_type_id for the owner it creates (or one without a type), and land_with_units_create takes owner_type_id
-- on each flat or house (falling back to p.owner_type_id). An owner who already has a type keeps it.

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.field_land_create(jsonb)'::regprocedure);
  n := replace(d, $a$  insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_parcel, v_party, 'owner', 100);$a$,
                  $b$  insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_parcel, v_party, 'owner', 100);
  -- The owner type chosen on the form (0295).
  update public.parties pa set owner_type_id = ot.id
    from public.owner_types ot
   where pa.id = v_party and pa.owner_type_id is null and ot.active
     and ot.id = nullif(p ->> 'owner_type_id', '')::uuid;$b$);
  if n = d then
    raise exception 'field_land_create: anchor not found';
  end if;
  execute n;

  d := pg_get_functiondef('public.land_with_units_create(jsonb)'::regprocedure);
  n := replace(d, $a$    insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_child, v_party, 'owner', 100);$a$,
                  $b$    insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_child, v_party, 'owner', 100);
    -- The owner type chosen on the form (0295): the flat's own, else the one for the whole land.
    update public.parties pa set owner_type_id = ot.id
      from public.owner_types ot
     where pa.id = v_party and pa.owner_type_id is null and ot.active
       and ot.id = coalesce(nullif(v_u ->> 'owner_type_id', ''), nullif(p ->> 'owner_type_id', ''))::uuid;$b$);
  if n = d then
    raise exception 'land_with_units_create: anchor not found';
  end if;
  execute n;
end;
$do$;
