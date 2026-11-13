-- Migration center, part 2: the old system's owners, land, bills and payments (not only the books).
-- Owners come first, then land (with its owner), then bills, then payments; land demolished in the old system is then
-- marked demolished the system's own way, so it never shows as standing. Old history is brought in quietly: no SMS
-- receipts, no commissions, and no postings to this year's books (the books come from the accounting migration).
-- Every house gets our PUN and account number; its old number is kept (legacy_ref) and can be searched. Land the old
-- system had no location for is put at its neighbourhood, marked "location to check", with a site check for surveyors.

alter table public.acct_migrations
  add column if not exists neighbourhood_map jsonb not null default '{}',   -- {old value: neighbourhood id}
  add column if not exists grade_map jsonb not null default '{}',           -- {old value: property grade code}
  add column if not exists fee_map jsonb not null default '{}';             -- {old value: fee type code}

alter table public.parcels add column if not exists legacy_ref text;
create index if not exists parcels_legacy_ref_idx on public.parcels (lower(legacy_ref)) where legacy_ref is not null;

alter table public.acct_migration_items drop constraint acct_migration_items_entity_check;
alter table public.acct_migration_items add constraint acct_migration_items_entity_check
  check (entity in ('account', 'entry', 'owner', 'land', 'bill', 'payment'));

-- While old history is brought in (app.migration = on): no journal postings, no receipt SMS, no commissions.
do $do$
declare
  r record;
  v text;
  v_new text;
begin
  for r in select * from (values
      ('private.invoice_line_post()', E'begin\n  select * into v_inv', E'begin\n  if current_setting(''app.migration'', true) = ''on'' then\n    return new;\n  end if;\n  select * into v_inv'),
      ('private.on_payment_received()', E'begin\n  if new.status <> ''completed''', E'begin\n  if current_setting(''app.migration'', true) = ''on'' then\n    return new;\n  end if;\n  if new.status <> ''completed'''),
      ('private.payment_commissions()', E'begin\n  if new.status = ''completed''', E'begin\n  if current_setting(''app.migration'', true) = ''on'' then\n    return null;\n  end if;\n  if new.status = ''completed''')
    ) t(fn, find, put)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    v_new := replace(v, r.find, r.put);
    if v_new = v then
      raise exception '%: text not found', r.fn;
    end if;
    execute v_new;
  end loop;

  -- The mapping save keeps the three new maps too.
  v := pg_get_functiondef('public.acct_migration_save(uuid,jsonb)'::regprocedure);
  v_new := replace(v, E'district_map = coalesce(p -> ''district_map'', district_map),',
    E'district_map = coalesce(p -> ''district_map'', district_map),\n         neighbourhood_map = coalesce(p -> ''neighbourhood_map'', neighbourhood_map),\n         grade_map = coalesce(p -> ''grade_map'', grade_map),\n         fee_map = coalesce(p -> ''fee_map'', fee_map),');
  if v_new = v then
    raise exception 'acct_migration_save: text not found';
  end if;
  execute v_new;
end;
$do$;

alter function private.migration_post(uuid) rename to migration_post_books;

/** Owners, land, bills, payments and demolitions, in that order, each record on its own (one failing doesn't stop the rest). */
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
  v_n jsonb := '{"owners_created": 0, "owners_matched": 0, "land": 0, "bills": 0, "payments": 0, "demolished": 0, "to_check": 0}';
  v_failed int := 0;
  v_skipped int := 0;
  v_fail jsonb := '[]';
begin
  perform set_config('app.migration', 'on', true);

  -- Owners: the same name and phone as an owner already here is that owner, not a copy.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'owner' order by source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      select id into v_party from public.parties
       where deleted_at is null and lower(trim(full_name)) = lower(trim(r.data ->> 'full_name'))
         and phone is not distinct from nullif(r.data ->> 'phone', '') limit 1;
      if v_party is not null then
        insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id, created) values (p_id, 'owner', r.source_key, v_party, false)
        on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = false;
        v_n := jsonb_set(v_n, '{owners_matched}', to_jsonb((v_n ->> 'owners_matched')::int + 1));
      else
        insert into public.parties (full_name, phone, mother_name, legacy_id, created_by)
        values (trim(r.data ->> 'full_name'), nullif(r.data ->> 'phone', ''), nullif(r.data ->> 'mother_name', ''), r.source_key, auth.uid())
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
      select n.id, c.district_id, n.geom into nb from public.neighbourhoods n join public.sectors s on s.id = n.sector_id join public.sections c on c.id = s.section_id
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
          raise exception 'the neighbourhood has no boundary to place the land in';
        end if;
      end if;
      -- A square of the land's size (at least 6 m a side) around its point.
      v_half := greatest(sqrt(coalesce(nullif((r.data ->> 'area')::numeric, 0), (r.data ->> 'width')::numeric * (r.data ->> 'length')::numeric, 100)) / 2, 3) / 111320.0;
      insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, property_type, land_use, plot_width_m, plot_length_m, area_m2,
                                  geom, geom_provisional, status, registered_at, legacy_ref, site_check_status, site_check_requested_at, site_check_requested_by,
                                  site_check_note)
      values (v_pun, v_acc, nb.district_id, nb.id, nullif(r.data ->> 'house_no', ''), nullif(r.data ->> 'property_type', ''),
              coalesce(nullif(r.data ->> 'land_use', ''), 'residential')::public.land_use,
              nullif(r.data ->> 'width', '')::numeric, nullif(r.data ->> 'length', '')::numeric,
              coalesce(nullif(r.data ->> 'area', '')::numeric, nullif(r.data ->> 'width', '')::numeric * nullif(r.data ->> 'length', '')::numeric),
              extensions.st_expand(v_pt, v_half::float8)::extensions.geometry(Polygon, 4326),
              nullif(r.data ->> 'lat', '') is null, 'registered', coalesce(nullif(r.data ->> 'registered_at', '')::date, current_date),
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
        jsonb_build_object('old_pun', r.data ->> 'legacy_pun', 'old_account', r.data ->> 'legacy_account', 'old_id', r.source_key));
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
      insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
      select private.invoice_number(v_year), p.id, p.district_id, v_fee, v_year::text,
             coalesce(nullif(r.data ->> 'issue_date', '')::date, make_date(v_year, 1, 1)),
             coalesce(nullif(r.data ->> 'due_date', '')::date, make_date(v_year, 12, 31)), round((r.data ->> 'amount')::numeric, 2)
        from public.parcels p where p.id = v_parcel
      returning id into v_inv;
      insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
      values (v_inv, case when v_code = 'service_charge' then 'service' else 'tax' end::public.invoice_line_kind,
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
                                   payer_name, payer_phone, reference, created_by)
      select private.next_receipt_no('MIG', extract(year from (r.data ->> 'date')::date)::int), coalesce(nullif(r.data ->> 'method', ''), 'cash')::public.payment_method,
             'USD', round((r.data ->> 'amount')::numeric, 2), round((r.data ->> 'amount')::numeric, 2), p.id, p.district_id,
             (r.data ->> 'date')::date, 'completed', 'verified', nullif(r.data ->> 'payer_name', ''), nullif(r.data ->> 'payer_phone', ''),
             left(coalesce(nullif(r.data ->> 'ref', ''), 'old:' || r.source_key), 120), auth.uid()
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

/** The whole run: the books (accounts, journal), then the property data. */
create or replace function private.migration_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_books jsonb := private.migration_post_books(p_id);
  v_prop jsonb := private.migration_post_property(p_id);
begin
  return v_books || (v_prop - 'failed' - 'skipped' - 'failures') || jsonb_build_object(
    'failed', (v_books ->> 'failed')::int + (v_prop ->> 'failed')::int,
    'skipped', (v_books ->> 'skipped')::int + (v_prop ->> 'skipped')::int,
    'failures', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements((v_books -> 'failures') || (v_prop -> 'failures')) x limit 500) s));
end;
$$;
revoke all on function private.migration_post(uuid) from public, anon, authenticated;

/** Undo also takes the property data back out, unless something new was done with that land since. */
create or replace function public.acct_migration_undo(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
  v_entries uuid[];
  v_land uuid[];
  v_bills uuid[];
  v_pays uuid[];
  v_owners uuid[];
  v_lines int;
  v_accounts int;
begin
  if v.status <> 'migrated' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  select coalesce(array_agg(target_id::uuid) filter (where entity = 'entry'), '{}'),
         coalesce(array_agg(target_id::uuid) filter (where entity = 'land'), '{}'),
         coalesce(array_agg(target_id::uuid) filter (where entity = 'bill'), '{}'),
         coalesce(array_agg(target_id::uuid) filter (where entity = 'payment'), '{}'),
         coalesce(array_agg(target_id::uuid) filter (where entity = 'owner' and created), '{}')
    into v_entries, v_land, v_bills, v_pays, v_owners
    from public.acct_migration_id_map where migration_id = p_id;
  if exists (select 1 from public.journal_entries e where e.reverses = any (v_entries) or (e.id = any (v_entries) and e.reversed_by is not null))
     or exists (select 1 from public.invoices i where i.parcel_id = any (v_land) and not (i.id = any (v_bills)))
     or exists (select 1 from public.payments p where p.parcel_id = any (v_land) and not (p.id = any (v_pays)))
     or exists (select 1 from public.payment_reversals x where x.payment_id = any (v_pays))
     or exists (select 1 from public.payment_corrections x where x.payment_id = any (v_pays))
     or exists (select 1 from public.issued_documents d where d.parcel_id = any (v_land))
     or exists (select 1 from public.transfers t where t.parcel_id = any (v_land))
     or exists (select 1 from public.parcels c where c.parent_id = any (v_land)) then
    perform private.raise_app_error('CONFLICT', 'migration_entries_used');
  end if;
  update public.fiscal_periods f set status = 'open', locked_by = null, locked_at = null
    from jsonb_array_elements(coalesce(v.run_result -> 'locked_months', '[]')) x
   where f.year = (x ->> 'year')::int and f.month = (x ->> 'month')::int;
  if exists (select 1 from public.journal_entries e join public.fiscal_periods f
               on f.year = extract(year from e.entry_date)::int and f.month = extract(month from e.entry_date)::int and f.status = 'locked'
              where e.id = any (v_entries)) then
    perform private.raise_app_error('CONFLICT', 'period_locked');
  end if;

  -- Property data, children first.
  delete from public.payment_allocations where payment_id = any (v_pays);
  delete from public.commission_entries where payment_id = any (v_pays);
  delete from public.payments where id = any (v_pays);
  delete from public.payment_intents where invoice_id = any (v_bills);
  delete from public.invoices where id = any (v_bills);
  delete from public.demolitions where parcel_id = any (v_land);
  delete from public.parcel_history where parcel_id = any (v_land);
  delete from public.parcel_owners where parcel_id = any (v_land);
  delete from public.parcels where id = any (v_land);
  delete from public.parties p where p.id = any (v_owners)
     and not exists (select 1 from public.parcel_owners o where o.party_id = p.id)
     and not exists (select 1 from public.application_parties a where a.party_id = p.id);

  -- The books.
  delete from public.journal_lines where entry_id = any (v_entries);
  get diagnostics v_lines = row_count;
  delete from public.journal_entries where id = any (v_entries);
  delete from public.gl_accounts a
   using public.acct_migration_id_map m
   where m.migration_id = p_id and m.entity = 'account' and m.created and a.code = m.target_id
     and not exists (select 1 from public.journal_lines l where l.account = a.code);
  get diagnostics v_accounts = row_count;

  delete from public.acct_migration_id_map where migration_id = p_id;
  update public.acct_migration_items set status = 'ready', message = null where migration_id = p_id and status in ('migrated', 'failed');
  update public.acct_migrations set status = 'undone', undone_at = now() where id = p_id;
  perform private.migration_log(p_id, 'undo', 'Run taken back out (' || cardinality(v_entries) || ' entries, ' || v_lines || ' lines, '
    || v_accounts || ' accounts, ' || cardinality(v_land) || ' land, ' || cardinality(v_bills) || ' bills, ' || cardinality(v_pays) || ' payments): ' || trim(p_reason));
  return jsonb_build_object('entries', cardinality(v_entries), 'lines', v_lines, 'accounts', v_accounts,
                            'land', cardinality(v_land), 'bills', cardinality(v_bills), 'payments', cardinality(v_pays));
end;
$$;

-- Our side, stage 4: the property tables too.
do $do$
declare
  v text := pg_get_functiondef('public.acct_migration_target_schema()'::regprocedure);
  v_new text := replace(v, $q$array['gl_accounts', 'journal_entries', 'journal_lines', 'fiscal_periods', 'districts']$q$,
                           $q$array['gl_accounts', 'journal_entries', 'journal_lines', 'fiscal_periods', 'parties', 'parcels', 'parcel_owners', 'invoices', 'payments', 'payment_allocations', 'neighbourhoods', 'property_grades', 'fee_types']$q$);
begin
  if v_new = v then
    raise exception 'acct_migration_target_schema: text not found';
  end if;
  execute v_new;
end;
$do$;
