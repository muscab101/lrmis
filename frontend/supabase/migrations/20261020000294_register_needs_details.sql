-- Land can't be moved to registered until its details are filled in (owner's request, 2026-11-27).
-- Needed: House No, property type, land use, width and length (a flat or house in a building: its own m²), upper
-- storeys (at least 1) for a storey building, and every owner's phone and owner type. Plot number stays optional.
-- Registering refuses with CONFLICT "missing:<what>,<what>" (the screen lists them). Registering by itself when the
-- bills are paid already catches errors: such land stays partial (event auto_register_failed) until it is completed.

/** What a land still lacks before it can be registered (empty = complete). */
create or replace function private.parcel_missing(p_parcel uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(k order by o), '{}')
    from public.parcels p
    cross join lateral (values
      (1, 'house_no', p.parent_id is null and nullif(trim(coalesce(p.house_no, '')), '') is null),
      (2, 'property_type', p.parent_id is null and p.property_type is null),
      (3, 'land_use', p.land_use is null),
      (4, 'size', case when p.parent_id is null
                       then coalesce(p.plot_width_m, 0) <= 0 or coalesce(p.plot_length_m, 0) <= 0
                       else coalesce(p.own_m2, 0) <= 0 end),
      (5, 'upper_storeys', p.parent_id is null and p.property_type = 'storey' and p.layout = 'house'
                           and coalesce(p.upper_storeys, 0) < 1),
      (6, 'owner_phone', exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                                  where po.parcel_id = p.id and po.valid_to is null and po.role in ('owner', 'co_owner', 'heir')
                                    and nullif(trim(coalesce(pa.phone, '')), '') is null)),
      (7, 'owner_type', exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                                 where po.parcel_id = p.id and po.valid_to is null and po.role in ('owner', 'co_owner', 'heir')
                                   and pa.owner_type_id is null))
    ) m(o, k, missing)
   where p.id = p_parcel and m.missing;
$$;
revoke all on function private.parcel_missing(uuid) from public, anon, authenticated;

/** For the screens: what a land still needs before it can be registered. */
create or replace function public.parcel_missing_details(p_parcel uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.parcels where id = p_parcel and deleted_at is null and public.can_access_district(district_id)) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  return private.parcel_missing(p_parcel);
end;
$$;
revoke all on function public.parcel_missing_details(uuid) from public, anon;
grant execute on function public.parcel_missing_details(uuid) to authenticated;

-- Registering checks it, once the owners are in place.
do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('private.parcel_register_one(uuid, public.land_use, text)'::regprocedure);
  n := replace(d, $a$    perform private.raise_app_error('CONFLICT', 'no_owner');
  end if;
$a$, $b$    perform private.raise_app_error('CONFLICT', 'no_owner');
  end if;
  -- Every detail filled in first (0294).
  if cardinality(private.parcel_missing(v.id)) > 0 then
    perform private.raise_app_error('CONFLICT', 'missing:' || array_to_string(private.parcel_missing(v.id), ','));
  end if;
$b$);
  if n = d then
    raise exception 'parcel_register_one: anchor not found';
  end if;
  execute n;
end;
$do$;
