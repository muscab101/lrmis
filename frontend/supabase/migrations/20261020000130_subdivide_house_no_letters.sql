-- Subdivided parcels also get the parent's House No with the same letter (07 -> 07A, 07B) and keep its plot number.
-- Their "created from" history entry says it was a subdivision and of which PUN.

/** One parcel of a subdivision: the parent's PUN and House No + letter, a new account number, and its owners. */
create or replace function private.spawn_subdivided(p_template uuid, p_geom extensions.geometry, p_source text, p_letter text, p_owners jsonb)
returns uuid
language plpgsql
security definer
set search_path = extensions
as $$
declare
  t public.parcels;
  v_id uuid;
  v_pun text;
  v_account int;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_owners) = 'array' then p_owners end), 0);
begin
  select * into t from public.parcels where id = p_template;
  v_pun := t.pun || p_letter;
  if exists (select 1 from public.parcels where pun = v_pun) then
    perform private.raise_app_error('CONFLICT', 'pun_taken');
  end if;
  insert into public.pun_counters (district_id) values (t.district_id) on conflict do nothing;
  update public.pun_counters set last_account = last_account + 1 where district_id = t.district_id returning last_account into v_account;
  insert into public.parcels (pun, account_no, house_no, plot_no, district_id, neighbourhood_id, street_id, ownership, land_use, developed, area_m2, perimeter_m, geom,
                              status, registered_at, registered_by, created_by)
  values (v_pun,
          private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'), '{district}{serial:7}'),
                                (select code from public.districts where id = t.district_id), (select code from public.neighbourhoods where id = t.neighbourhood_id), v_account),
          nullif(trim(t.house_no), '') || p_letter, t.plot_no,
          t.district_id, t.neighbourhood_id, t.street_id, t.ownership, t.land_use, t.developed,
          round(st_area(p_geom::geography)::numeric, 2), round(st_perimeter(p_geom::geography)::numeric, 2), p_geom,
          'registered', now(), auth.uid(), auth.uid())
  returning id into v_id;
  if n = 0 then
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, party_id, role, share_pct from public.parcel_owners where parcel_id = p_template and valid_to is null;
  else
    insert into public.parcel_owners (parcel_id, party_id, role, share_pct)
    select v_id, x::uuid, (case when k = 1 then 'owner' else 'co_owner' end)::public.application_party_role,
           case when k < n then round(100.0 / n, 2) else 100 - round(100.0 / n, 2) * (n - 1) end
      from jsonb_array_elements_text(p_owners) with ordinality as e(x, k);
  end if;
  perform private.parcel_event(v_id, 'created_from', p_source, jsonb_build_object('source_parcel', p_template, 'kind', 'subdivide', 'pun', t.pun));
  return v_id;
end;
$$;
