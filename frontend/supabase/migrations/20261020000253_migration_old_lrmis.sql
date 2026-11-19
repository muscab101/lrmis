-- Migration center, part 3: what the old LRMIS (2015-2016) needs to come in whole.
-- 1. Land with no GPS point whose neighbourhood has no boundary yet (every neighbourhood today) is placed at its sector's
--    or section's map point, else the middle of its district, spread a little so houses don't sit on one spot, and is
--    marked "location to check" with a site check, as before. Until now such land failed.
-- 2. More of the old record is kept: an owner's nationality, ID number, email, address and next of kin; the land's plot
--    number, deed, government file and receipt numbers, ownership, developed, use; a note on bills and payments.
-- 3. While old history comes in, paying its bills issues nothing: no certificates or ID cards, no SMS, no notices
--    (old land gets its certificate the normal way afterwards). Until now the run issued a certificate and ID card for
--    every fully paid old plot, sent their SMS, and then could not be undone.
-- 4. Old land's yearly tax day (tax anniversary) is the day it was registered in the old system, so yearly bills follow
--    the old dates. Years before automatic billing started show under Billing runs → Missed yearly bills.
-- 5. An index so receipt numbers stay quick as payments grow.

create or replace function private.migration_post_property(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  b record;
  nb record;
  v_party uuid;
  v_parcel uuid;
  v_pun text;
  v_acc text;
  v_pt extensions.geometry;
  v_half numeric;
  v_inv uuid;
  v_fee uuid;
  v_code text;
  v_year int;
  v_pay uuid;
  v_left numeric;
  v_applied numeric;
  v_dem uuid;
  v_id_number text;
  v_id_type public.id_document_type;
  v_angle float8;
  v_n jsonb := '{"owners_created": 0, "owners_matched": 0, "land": 0, "bills": 0, "payments": 0, "demolished": 0, "to_check": 0}';
  v_failed int := 0;
  v_skipped int := 0;
  v_fail jsonb := '[]';
begin
  perform set_config('app.migration', 'on', true);

  -- Owners: the same ID document, or the same name and phone, as an owner already here is that owner, not a copy.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'owner' order by source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_id_number := private.normalise_id_number(r.data ->> 'id_number');
      v_id_type := case when v_id_number is null then null else coalesce(nullif(r.data ->> 'id_type', ''), 'national_id')::public.id_document_type end;
      v_party := null;
      if v_id_number is not null then
        select id into v_party from public.parties
         where deleted_at is null and id_type = v_id_type and upper(regexp_replace(id_number, '\s', '', 'g')) = upper(regexp_replace(v_id_number, '\s', '', 'g'))
         limit 1;
      end if;
      if v_party is null then
        select id into v_party from public.parties
         where deleted_at is null and lower(trim(full_name)) = lower(trim(r.data ->> 'full_name'))
           and phone is not distinct from nullif(r.data ->> 'phone', '') limit 1;
      end if;
      if v_party is not null then
        insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id, created) values (p_id, 'owner', r.source_key, v_party, false)
        on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = false;
        v_n := jsonb_set(v_n, '{owners_matched}', to_jsonb((v_n ->> 'owners_matched')::int + 1));
      else
        insert into public.parties (full_name, phone, mother_name, nationality, id_type, id_number, email, address, next_of_kin, legacy_id, created_by)
        values (trim(r.data ->> 'full_name'), nullif(r.data ->> 'phone', ''), nullif(r.data ->> 'mother_name', ''),
                coalesce(nullif(r.data ->> 'nationality', ''), 'SO'), v_id_type, v_id_number, nullif(r.data ->> 'email', ''),
                nullif(r.data ->> 'address', ''), coalesce(r.data -> 'next_of_kin', '{}'::jsonb), r.source_key, auth.uid())
        returning id into v_party;
        insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id, created) values (p_id, 'owner', r.source_key, v_party, true)
        on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
        v_n := jsonb_set(v_n, '{owners_created}', to_jsonb((v_n ->> 'owners_created')::int + 1));
      end if;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'owner' and source_key = r.source_key;
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'owner', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'owner' and source_key = r.source_key;
    end;
  end loop;

  -- Land: registered, with our PUN and account number; the old number kept.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'land' order by source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      select n.id, c.district_id, n.geom, n.sector_id, s.point as sector_point, c.point as section_point into nb
        from public.neighbourhoods n join public.sectors s on s.id = n.sector_id join public.sections c on c.id = s.section_id
       where n.id = (r.data ->> 'neighbourhood_id')::uuid;
      if nb.id is null then
        raise exception 'no neighbourhood here for this land';
      end if;
      select x.pun, x.account_no into v_pun, v_acc from private.next_pun(nb.district_id, nb.id) x;
      if nullif(r.data ->> 'lat', '') is not null and nullif(r.data ->> 'lon', '') is not null then
        v_pt := extensions.st_setsrid(extensions.st_makepoint((r.data ->> 'lon')::float8, (r.data ->> 'lat')::float8), 4326);
      else
        v_pt := extensions.st_pointonsurface(nb.geom);
        if v_pt is null then
          -- No boundary yet: near the sector's or section's point, else the middle of the district, each house a little
          -- apart (up to about 150 m, always the same spot for the same old record) until a surveyor checks it.
          v_pt := coalesce(nb.sector_point, nb.section_point,
                           (select coalesce(d.label_point, extensions.st_pointonsurface(d.geom)) from public.districts d where d.id = nb.district_id));
          if v_pt is null then
            raise exception 'nowhere on the map for this land: its neighbourhood, sector, section and district have no boundary or point';
          end if;
          v_angle := (abs(hashtext(r.source_key)) % 3600) / 10.0;
          v_pt := extensions.st_translate(v_pt,
                    cos(radians(v_angle)) * (30 + abs(hashtext('r' || r.source_key)) % 120) / 111320.0,
                    sin(radians(v_angle)) * (30 + abs(hashtext('r' || r.source_key)) % 120) / 111320.0);
        end if;
      end if;
      -- A square of the land's size (at least 6 m a side) around its point.
      v_half := greatest(sqrt(coalesce(nullif((r.data ->> 'area')::numeric, 0), (r.data ->> 'width')::numeric * (r.data ->> 'length')::numeric, 100)) / 2, 3) / 111320.0;
      insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, plot_no, deed_no, govt_file_no, govt_receipt_no,
                                  ownership, developed, property_type, land_use, plot_width_m, plot_length_m, area_m2,
                                  geom, geom_provisional, status, registered_at, tax_anniversary, legacy_ref, site_check_status, site_check_requested_at,
                                  site_check_requested_by, site_check_note)
      values (v_pun, v_acc, nb.district_id, nb.id, nullif(r.data ->> 'house_no', ''), nullif(r.data ->> 'plot_no', ''),
              nullif(r.data ->> 'deed_no', ''), nullif(r.data ->> 'govt_file_no', ''), nullif(r.data ->> 'govt_receipt_no', ''),
              coalesce(nullif(r.data ->> 'ownership', ''), 'private')::public.ownership_type, coalesce(nullif(r.data ->> 'developed', '')::boolean, false),
              nullif(r.data ->> 'property_type', ''),
              coalesce(nullif(r.data ->> 'land_use', ''), 'residential')::public.land_use,
              nullif(r.data ->> 'width', '')::numeric, nullif(r.data ->> 'length', '')::numeric,
              coalesce(nullif(r.data ->> 'area', '')::numeric, nullif(r.data ->> 'width', '')::numeric * nullif(r.data ->> 'length', '')::numeric),
              extensions.st_expand(v_pt, v_half::float8)::extensions.geometry(Polygon, 4326),
              nullif(r.data ->> 'lat', '') is null, 'registered', coalesce(nullif(r.data ->> 'registered_at', '')::date, current_date),
              coalesce(nullif(r.data ->> 'registered_at', '')::date, current_date),
              coalesce(nullif(r.data ->> 'legacy_pun', ''), nullif(r.data ->> 'legacy_account', ''), r.source_key),
              case when nullif(r.data ->> 'lat', '') is null then 'pending' end,
              case when nullif(r.data ->> 'lat', '') is null then now() end,
              case when nullif(r.data ->> 'lat', '') is null then auth.uid() end,
              case when nullif(r.data ->> 'lat', '') is null then 'Location to check: brought in from the old system without one' end)
      returning id into v_parcel;
      if nullif(r.data ->> 'owner_key', '') is not null then
        select target_id::uuid into v_party from public.acct_migration_id_map where migration_id = p_id and entity = 'owner' and source_id = r.data ->> 'owner_key';
        if v_party is null then
          raise exception 'its owner % was not brought in', r.data ->> 'owner_key';
        end if;
        insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values (v_parcel, v_party, 'owner', 100);
      end if;
      perform private.parcel_event(v_parcel, 'migrated', 'Brought in from the old system',
        jsonb_build_object('old_pun', r.data ->> 'legacy_pun', 'old_account', r.data ->> 'legacy_account', 'old_id', r.source_key)
          || coalesce(r.data -> 'old', '{}'::jsonb));
      insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id) values (p_id, 'land', r.source_key, v_parcel)
      on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'land' and source_key = r.source_key;
      v_n := jsonb_set(v_n, '{land}', to_jsonb((v_n ->> 'land')::int + 1));
      if nullif(r.data ->> 'lat', '') is null then
        v_n := jsonb_set(v_n, '{to_check}', to_jsonb((v_n ->> 'to_check')::int + 1));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'land', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'land' and source_key = r.source_key;
    end;
  end loop;

  -- Bills, oldest year first.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'bill' order by (data ->> 'year'), source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      select target_id::uuid into v_parcel from public.acct_migration_id_map where migration_id = p_id and entity = 'land' and source_id = r.data ->> 'land_key';
      if v_parcel is null then
        raise exception 'its land % was not brought in', r.data ->> 'land_key';
      end if;
      v_code := r.data ->> 'fee_code';
      select id into v_fee from public.fee_types where code = v_code;
      if v_fee is null then
        raise exception 'fee type % does not exist here', v_code;
      end if;
      v_year := (r.data ->> 'year')::int;
      insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note)
      select private.invoice_number(v_year), p.id, p.district_id, v_fee, v_year::text,
             coalesce(nullif(r.data ->> 'issue_date', '')::date, make_date(v_year, 1, 1)),
             coalesce(nullif(r.data ->> 'due_date', '')::date, make_date(v_year, 12, 31)), round((r.data ->> 'amount')::numeric, 2),
             nullif(r.data ->> 'note', '')
        from public.parcels p where p.id = v_parcel
      returning id into v_inv;
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (v_inv, case when v_code = 'service_charge' then 'service' when v_code in ('property_bill', 'property_tax') then 'tax' else 'fee' end::public.invoice_line_kind,
              'Bill from the old system' || coalesce(' (' || nullif(r.data ->> 'ref', '') || ')', ''), round((r.data ->> 'amount')::numeric, 2), auth.uid());
      insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id) values (p_id, 'bill', r.source_key, v_inv)
      on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'bill' and source_key = r.source_key;
      v_n := jsonb_set(v_n, '{bills}', to_jsonb((v_n ->> 'bills')::int + 1));
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'bill', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'bill' and source_key = r.source_key;
    end;
  end loop;

  -- Payments, oldest first: onto their own bill, or else the land's oldest unpaid bills; anything left over is credit.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'payment' order by (data ->> 'date'), source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_inv := null;
      if nullif(r.data ->> 'bill_key', '') is not null then
        select target_id::uuid into v_inv from public.acct_migration_id_map where migration_id = p_id and entity = 'bill' and source_id = r.data ->> 'bill_key';
        if v_inv is null then
          raise exception 'its bill % was not brought in', r.data ->> 'bill_key';
        end if;
        select parcel_id into v_parcel from public.invoices where id = v_inv;
      else
        select target_id::uuid into v_parcel from public.acct_migration_id_map where migration_id = p_id and entity = 'land' and source_id = r.data ->> 'land_key';
      end if;
      if v_parcel is null then
        raise exception 'its land % was not brought in', r.data ->> 'land_key';
      end if;
      insert into public.payments (receipt_no, method, currency, amount, amount_base, parcel_id, district_id, received_at, status, verify_status,
                                   payer_name, payer_phone, reference, note, created_by)
      select private.next_receipt_no('MIG', extract(year from (r.data ->> 'date')::date)::int), coalesce(nullif(r.data ->> 'method', ''), 'cash')::public.payment_method,
             'USD', round((r.data ->> 'amount')::numeric, 2), round((r.data ->> 'amount')::numeric, 2), p.id, p.district_id,
             (r.data ->> 'date')::date, 'completed', 'verified', nullif(r.data ->> 'payer_name', ''), nullif(r.data ->> 'payer_phone', ''),
             left(coalesce(nullif(r.data ->> 'ref', ''), 'old:' || r.source_key), 120), nullif(r.data ->> 'note', ''), auth.uid()
        from public.parcels p where p.id = v_parcel
      returning id into v_pay;
      v_left := round((r.data ->> 'amount')::numeric, 2);
      for b in
        select i.id from public.invoices i
         where (v_inv is not null and i.id = v_inv)
            or (v_inv is null and i.parcel_id = v_parcel and i.status in ('issued', 'partially_paid'))
         order by i.issue_date, i.created_at
      loop
        exit when v_left <= 0;
        v_applied := private.invoice_apply_payment(b.id, v_left);
        if v_applied > 0 then
          insert into public.payment_allocations (payment_id, invoice_id, amount) values (v_pay, b.id, v_applied);
          v_left := v_left - v_applied;
        end if;
      end loop;
      update public.payments set unallocated = greatest(v_left, 0) where id = v_pay;
      insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id) values (p_id, 'payment', r.source_key, v_pay)
      on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'payment' and source_key = r.source_key;
      v_n := jsonb_set(v_n, '{payments}', to_jsonb((v_n ->> 'payments')::int + 1));
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'payment', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'payment' and source_key = r.source_key;
    end;
  end loop;

  -- Land demolished in the old system: demolished here too, the system's own way (it keeps its place and history).
  for r in
    select i.source_key, i.data, m.target_id::uuid as parcel_id from public.acct_migration_items i
      join public.acct_migration_id_map m on m.migration_id = i.migration_id and m.entity = 'land' and m.source_id = i.source_key
     where i.migration_id = p_id and i.entity = 'land' and i.status = 'migrated' and coalesce((i.data ->> 'demolished')::boolean, false)
  loop
    begin
      insert into public.demolitions (number, parcel_id, batch_id, district_id, neighbourhood_id, pun, house_no, demolition_date, reason, snapshot, requested_by)
      select 'DEM-' || extract(year from current_date)::int || '-' || lpad(private.next_serial('DEM-' || extract(year from current_date)::int)::text, 6, '0'),
             p.id, gen_random_uuid(), p.district_id, p.neighbourhood_id, p.pun, p.house_no,
             coalesce(nullif(r.data ->> 'demolished_at', '')::date, current_date), 'Demolished in the old system', '{}'::jsonb, auth.uid()
        from public.parcels p where p.id = r.parcel_id
      returning id into v_dem;
      perform private.demolition_apply(v_dem, 'Brought in from the old system');
      v_n := jsonb_set(v_n, '{demolished}', to_jsonb((v_n ->> 'demolished')::int + 1));
    exception when others then
      v_fail := v_fail || jsonb_build_object('entity', 'land', 'key', r.source_key, 'message', 'brought in, but not marked demolished: ' || sqlerrm);
    end;
  end loop;

  perform set_config('app.migration', '', true);
  return v_n || jsonb_build_object('failed', v_failed, 'skipped', v_skipped, 'failures', v_fail);
end;
$$;
revoke all on function private.migration_post_property(uuid) from public, anon, authenticated;

-- 3. No certificates or ID cards (and so no SMS or notices) while old history comes in.
do $do$
declare
  v text := pg_get_functiondef('private.try_auto_certificate(uuid)'::regprocedure);
  v_new text := replace(v, E'begin\n  perform private.documents_expire(p_parcel);',
    E'begin\n  if current_setting(''app.migration'', true) = ''on'' then\n    return null;\n  end if;\n  perform private.documents_expire(p_parcel);');
begin
  if v_new = v then
    raise exception 'try_auto_certificate: text not found';
  end if;
  execute v_new;
end;
$do$;

-- 5. Receipt numbers stay quick as payments grow: a new receipt number looks up the highest one with its prefix, which
--    read every payment until now (thousands on a migration, and slower every day at the desks).
create index if not exists payments_receipt_no_prefix_idx on public.payments (receipt_no text_pattern_ops);
