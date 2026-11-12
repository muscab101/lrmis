-- Accounting → Migration: bring the old system's accounts and journal history in, safely.
-- The old file is read into staging tables here (never into the books). The Super Admin maps old tables and columns to
-- ours, maps old IDs (accounts, districts), previews, runs a test that is rolled back, takes a backup of the books,
-- then migrates. Every migrated record keeps its old ID in an ID map, entries are tagged "migration", and a run can be
-- undone. Only a Super Admin can see or do any of it.

-- Migrated journal entries are posted with their own source.
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source = any (array[
  'invoice', 'invoice_cancel', 'payment', 'reversal', 'manual', 'payment_correction', 'movement', 'movement_cancel', 'asset',
  'asset_cancel', 'depreciation', 'disposal', 'commission', 'commission_reversal', 'payout', 'migration']));

create table public.acct_migrations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) between 2 and 120),
  status             text not null default 'draft' check (status in ('draft', 'tested', 'migrated', 'undone')),
  source_kind        text not null check (source_kind in ('sql', 'csv')),
  source_files       jsonb not null default '[]',   -- [{name, path, bytes, sha256}]
  source_backup_at   timestamptz,
  source_backup_ok   boolean not null default false,
  target_backup_at   timestamptz,
  target_backup_ok   boolean not null default false,
  table_map          jsonb not null default '{}',   -- {old table: 'accounts' | 'entries' | 'lines' | 'ignore'}
  column_map         jsonb not null default '{}',   -- {entity: {field: {col, transform, format, default, factor}}}
  account_map        jsonb not null default '{}',   -- {old account key: {code, create, name_so, name_en, type}}
  district_map       jsonb not null default '{}',   -- {old district value: district id | ''}
  options            jsonb not null default '{}',   -- {lock_months: bool}
  prepared_at        timestamptz,
  prepared_summary   jsonb,
  test_at            timestamptz,
  test_prepared_at   timestamptz,
  test_result        jsonb,
  run_at             timestamptz,
  run_result         jsonb,
  undone_at          timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);
create index acct_migrations_created_by_idx on public.acct_migrations (created_by);
create trigger set_updated_at before update on public.acct_migrations for each row execute function private.set_updated_at();

/** The old database's tables as read from the file: columns, keys, indexes, counts, what is missing or repeated. */
create table public.acct_migration_tables (
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  name          text not null,
  columns       jsonb not null default '[]',   -- [{name, type, nullable, default}]
  primary_key   text[] not null default '{}',
  foreign_keys  jsonb not null default '[]',   -- [{columns, ref_table, ref_columns}]
  indexes       jsonb not null default '[]',   -- [{name, columns, unique}]
  row_count     int not null default 0,
  stats         jsonb not null default '{}',   -- {nulls: {col: n}, duplicates: n}
  primary key (migration_id, name)
);

/** The old rows, unchanged. */
create table public.acct_migration_rows (
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  table_name    text not null,
  row_no        int not null,
  data          jsonb not null,
  primary key (migration_id, table_name, row_no)
);

/** Each record after mapping: ready, or why it can't go; after the run, migrated / failed / skipped. */
create table public.acct_migration_items (
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  entity        text not null check (entity in ('account', 'entry')),
  source_key    text not null,
  data          jsonb not null,
  status        text not null check (status in ('ready', 'error', 'skipped', 'migrated', 'failed')),
  message       text,
  primary key (migration_id, entity, source_key)
);

/** Old ID → new ID, for every migrated record. */
create table public.acct_migration_id_map (
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  entity        text not null,
  source_id     text not null,
  target_id     text not null,
  created       boolean not null default true,   -- false: mapped to a record that was already there
  primary key (migration_id, entity, source_id)
);
create index acct_migration_id_map_target_idx on public.acct_migration_id_map (entity, target_id);

/** Copy of the books before the run (to compare or restore by hand). */
create table public.acct_migration_backups (
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  table_name    text not null,
  row_count     int not null,
  rows          jsonb not null,
  taken_at      timestamptz not null default now(),
  primary key (migration_id, table_name)
);

create table public.acct_migration_log (
  id            bigint generated always as identity primary key,
  migration_id  uuid not null references public.acct_migrations (id) on delete cascade,
  at            timestamptz not null default now(),
  stage         text not null,
  message       text not null,
  by_user       uuid references auth.users (id) on delete set null
);
create index acct_migration_log_migration_idx on public.acct_migration_log (migration_id, at desc);
create index acct_migration_log_by_idx on public.acct_migration_log (by_user);

/** The signed-in user is a Super Admin (has every power): for row access rules. */
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.user_grants_all(auth.uid()) and private.caller_is_active();
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['acct_migrations', 'acct_migration_tables', 'acct_migration_rows', 'acct_migration_items',
                           'acct_migration_id_map', 'acct_migration_backups', 'acct_migration_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_super_admin()))', t || '_select', t);
  end loop;
end;
$$;

create or replace function private.assert_migration_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.user_grants_all(auth.uid()) or not private.caller_is_active() then
    perform private.raise_app_error('PERMISSION_DENIED', 'super_admin');
  end if;
end;
$$;
revoke all on function private.assert_migration_admin() from public, anon, authenticated;

create or replace function private.migration_log(p_id uuid, p_stage text, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.acct_migration_log (migration_id, stage, message, by_user) values (p_id, p_stage, p_message, auth.uid());
$$;
revoke all on function private.migration_log(uuid, text, text) from public, anon, authenticated;

/** A migration that is still being set up (not run yet). */
create or replace function private.migration_open(p_id uuid)
returns public.acct_migrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations;
begin
  perform private.assert_migration_admin();
  select * into v from public.acct_migrations where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'migration');
  end if;
  return v;
end;
$$;
revoke all on function private.migration_open(uuid) from public, anon, authenticated;

-- ---- Stage 1: the old file ----------------------------------------------------------------------------------------

create function public.acct_migration_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_migration_admin();
  insert into public.acct_migrations (name, source_kind, source_files, source_backup_at, source_backup_ok, created_by)
  values (trim(p ->> 'name'), p ->> 'source_kind', coalesce(p -> 'source_files', '[]'), now(),
          coalesce((p ->> 'source_backup_ok')::boolean, false), auth.uid())
  returning id into v_id;
  perform private.migration_log(v_id, 'prepare', 'Old ' || (p ->> 'source_kind') || ' file read and kept unchanged');
  return v_id;
end;
$$;

/** One old table's structure (from the file). */
create function public.acct_migration_add_table(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.migration_open(p_id);
  insert into public.acct_migration_tables (migration_id, name, columns, primary_key, foreign_keys, indexes, row_count, stats)
  values (p_id, p ->> 'name', coalesce(p -> 'columns', '[]'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'primary_key') x), '{}'),
          coalesce(p -> 'foreign_keys', '[]'), coalesce(p -> 'indexes', '[]'), coalesce((p ->> 'row_count')::int, 0), coalesce(p -> 'stats', '{}'))
  on conflict (migration_id, name) do update
    set columns = excluded.columns, primary_key = excluded.primary_key, foreign_keys = excluded.foreign_keys,
        indexes = excluded.indexes, row_count = excluded.row_count, stats = excluded.stats;
end;
$$;

/** A batch of one old table's rows (row_no from p_start). */
create function public.acct_migration_add_rows(p_id uuid, p_table text, p_start int, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.migration_open(p_id);
  if jsonb_array_length(p_rows) > 5000 then
    perform private.raise_app_error('VALIDATION', 'selection');
  end if;
  insert into public.acct_migration_rows (migration_id, table_name, row_no, data)
  select p_id, p_table, p_start + (r.ord - 1)::int, r.value from jsonb_array_elements(p_rows) with ordinality r(value, ord)
  on conflict (migration_id, table_name, row_no) do update set data = excluded.data;
  return jsonb_array_length(p_rows);
end;
$$;

-- ---- Stages 5–7: mapping (changing it means testing again) -----------------------------------------------------------

create function public.acct_migration_save(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
begin
  if v.status in ('migrated') then
    perform private.raise_app_error('CONFLICT', 'migration_done');
  end if;
  update public.acct_migrations
     set table_map = coalesce(p -> 'table_map', table_map),
         column_map = coalesce(p -> 'column_map', column_map),
         account_map = coalesce(p -> 'account_map', account_map),
         district_map = coalesce(p -> 'district_map', district_map),
         options = coalesce(p -> 'options', options),
         name = coalesce(nullif(trim(p ->> 'name'), ''), name),
         status = case when status = 'undone' then 'undone' else 'draft' end
   where id = p_id;
  perform private.migration_log(p_id, 'mapping', 'Mapping saved: ' || (select string_agg(k, ', ') from jsonb_object_keys(p) k));
end;
$$;

/** Stage 8: the records after mapping (worked out by the app), replacing the earlier preview. */
create function public.acct_migration_set_items(p_id uuid, p_items jsonb, p_reset boolean, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
begin
  if v.status = 'migrated' then
    perform private.raise_app_error('CONFLICT', 'migration_done');
  end if;
  if p_reset then
    delete from public.acct_migration_items where migration_id = p_id;
  end if;
  insert into public.acct_migration_items (migration_id, entity, source_key, data, status, message)
  select p_id, i ->> 'entity', i ->> 'source_key', i -> 'data', i ->> 'status', i ->> 'message'
    from jsonb_array_elements(p_items) i
  on conflict (migration_id, entity, source_key) do update set data = excluded.data, status = excluded.status, message = excluded.message;
  if p_summary is not null then
    update public.acct_migrations set prepared_at = now(), prepared_summary = p_summary,
           status = case when status = 'undone' then 'undone' else 'draft' end
     where id = p_id;
    perform private.migration_log(p_id, 'preview', 'Preview worked out: ' || p_summary::text);
  end if;
end;
$$;

-- ---- Stage 2: backups ---------------------------------------------------------------------------------------------

/** Copy the books (accounts, journal, periods) before the run, and check the copy is complete. */
create function public.acct_migration_backup(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
  v_ok boolean;
  v_out jsonb;
begin
  delete from public.acct_migration_backups where migration_id = p_id;
  insert into public.acct_migration_backups (migration_id, table_name, row_count, rows)
  select p_id, 'gl_accounts', count(*), coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.gl_accounts a
  union all
  select p_id, 'journal_entries', count(*), coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.journal_entries e
  union all
  select p_id, 'journal_lines', count(*), coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.journal_lines l
  union all
  select p_id, 'fiscal_periods', count(*), coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.fiscal_periods f;
  -- The copy can be restored when every table's rows are all there.
  select bool_and(jsonb_array_length(b.rows) = b.row_count) and count(*) = 4 into v_ok from public.acct_migration_backups b where b.migration_id = p_id;
  update public.acct_migrations set target_backup_at = now(), target_backup_ok = coalesce(v_ok, false) where id = p_id;
  select jsonb_object_agg(table_name, row_count) into v_out from public.acct_migration_backups where migration_id = p_id;
  perform private.migration_log(p_id, 'backup', 'Books backed up: ' || v_out::text || case when v_ok then ' (checked)' else ' (CHECK FAILED)' end);
  return jsonb_build_object('ok', coalesce(v_ok, false), 'counts', v_out);
end;
$$;

-- ---- Stage 4: our side ----------------------------------------------------------------------------------------------

/** The structure of the tables a migration writes to: columns, required or not, keys, links, rows there now. */
create function public.acct_migration_target_schema()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_migration_admin();
  return (
    select jsonb_agg(jsonb_build_object(
      'table', t.tbl,
      'rows', (select c.reltuples::bigint from pg_class c where c.oid = ('public.' || t.tbl)::regclass),
      'columns', (select jsonb_agg(jsonb_build_object('name', c.column_name, 'type', c.data_type, 'required', c.is_nullable = 'NO' and c.column_default is null,
                                                      'default', c.column_default) order by c.ordinal_position)
                    from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.tbl),
      'constraints', (select jsonb_agg(jsonb_build_object('name', k.conname, 'kind', k.contype, 'def', pg_get_constraintdef(k.oid)))
                        from pg_constraint k where k.conrelid = ('public.' || t.tbl)::regclass))
      order by t.ord)
    from unnest(array['gl_accounts', 'journal_entries', 'journal_lines', 'fiscal_periods', 'districts']) with ordinality t(tbl, ord));
end;
$$;

-- ---- Stages 9–11: test, then the real run -------------------------------------------------------------------------

/** Post every ready record: accounts first (new ones created, others mapped), then entries with their lines. */
create or replace function private.migration_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations;
  r record;
  l jsonb;
  v_lines jsonb;
  v_code text;
  v_district uuid;
  v_entry uuid;
  v_dr numeric;
  v_cr numeric;
  v_acc_new int := 0;
  v_acc_mapped int := 0;
  v_entries int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_fail jsonb := '[]';
  v_months jsonb := '[]';
  v_dr_total numeric := 0;
  v_cr_total numeric := 0;
begin
  select * into v from public.acct_migrations where id = p_id;
  -- Parents first: accounts.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'account' order by source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_code := r.data ->> 'code';
      if exists (select 1 from public.gl_accounts where code = v_code) then
        insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id, created) values (p_id, 'account', r.source_key, v_code, false)
        on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = false;
        v_acc_mapped := v_acc_mapped + 1;
      elsif coalesce((r.data ->> 'create')::boolean, false) then
        insert into public.gl_accounts (code, name_so, name_en, type, active, is_bank)
        values (v_code, coalesce(nullif(r.data ->> 'name_so', ''), r.data ->> 'name_en'), r.data ->> 'name_en', (r.data ->> 'type')::public.gl_type, true, false);
        insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id, created) values (p_id, 'account', r.source_key, v_code, true)
        on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
        v_acc_new := v_acc_new + 1;
      else
        raise exception 'account % is not in our chart of accounts', v_code;
      end if;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'account' and source_key = r.source_key;
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'account', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'account' and source_key = r.source_key;
    end;
  end loop;

  -- Then the journal: each old entry with its lines, on its own date, tagged as migrated.
  for r in select * from public.acct_migration_items where migration_id = p_id and entity = 'entry' order by (data ->> 'date'), source_key loop
    if r.status <> 'ready' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_lines := '[]';
      v_dr := 0;
      v_cr := 0;
      for l in select value from jsonb_array_elements(r.data -> 'lines') loop
        v_code := coalesce((select m.target_id from public.acct_migration_id_map m
                             where m.migration_id = p_id and m.entity = 'account' and m.source_id = l ->> 'account_key'),
                           (select a.code from public.gl_accounts a where a.code = l ->> 'account_key'));
        if v_code is null then
          raise exception 'old account % has no account here', l ->> 'account_key';
        end if;
        v_district := nullif(v.district_map ->> coalesce(l ->> 'district_key', ''), '')::uuid;
        v_lines := v_lines || jsonb_build_object('account', v_code, 'district_id', v_district,
                                                'debit', round(coalesce((l ->> 'debit')::numeric, 0), 2), 'credit', round(coalesce((l ->> 'credit')::numeric, 0), 2));
        v_dr := v_dr + round(coalesce((l ->> 'debit')::numeric, 0), 2);
        v_cr := v_cr + round(coalesce((l ->> 'credit')::numeric, 0), 2);
      end loop;
      if v_dr <> v_cr then
        raise exception 'debits % and credits % are not equal', v_dr, v_cr;
      end if;
      v_entry := private.post_journal((r.data ->> 'date')::date, 'migration', null,
                                      left('Migrated ' || coalesce(nullif(r.data ->> 'ref', ''), r.source_key) || coalesce(': ' || nullif(r.data ->> 'memo', ''), ''), 500),
                                      v_lines);
      if v_entry is null then
        raise exception 'the entry has no amount';
      end if;
      insert into public.acct_migration_id_map (migration_id, entity, source_id, target_id) values (p_id, 'entry', r.source_key, v_entry::text)
      on conflict (migration_id, entity, source_id) do update set target_id = excluded.target_id, created = true;
      update public.acct_migration_items set status = 'migrated', message = null where migration_id = p_id and entity = 'entry' and source_key = r.source_key;
      v_entries := v_entries + 1;
      v_dr_total := v_dr_total + v_dr;
      v_cr_total := v_cr_total + v_cr;
    exception when others then
      v_failed := v_failed + 1;
      v_fail := v_fail || jsonb_build_object('entity', 'entry', 'key', r.source_key, 'message', sqlerrm);
      update public.acct_migration_items set status = 'failed', message = sqlerrm where migration_id = p_id and entity = 'entry' and source_key = r.source_key;
    end;
  end loop;

  -- Old months locked afterwards, when asked (and not locked already).
  if coalesce((v.options ->> 'lock_months')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object('year', y, 'month', m)), '[]') into v_months
      from (select distinct extract(year from e.entry_date)::int y, extract(month from e.entry_date)::int m
              from public.acct_migration_id_map x join public.journal_entries e on e.id = x.target_id::uuid
             where x.migration_id = p_id and x.entity = 'entry'
               and not exists (select 1 from public.fiscal_periods f where f.year = extract(year from e.entry_date)::int
                                 and f.month = extract(month from e.entry_date)::int and f.status = 'locked')) z;
    insert into public.fiscal_periods (year, month, status, locked_by, locked_at)
    select (x ->> 'year')::int, (x ->> 'month')::int, 'locked', auth.uid(), now() from jsonb_array_elements(v_months) x
    on conflict (year, month) do update set status = 'locked', locked_by = excluded.locked_by, locked_at = excluded.locked_at;
  end if;

  return jsonb_build_object('accounts_created', v_acc_new, 'accounts_mapped', v_acc_mapped, 'entries', v_entries,
                            'failed', v_failed, 'skipped', v_skipped, 'failures', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(v_fail) x limit 500) s),
                            'debit', v_dr_total, 'credit', v_cr_total, 'locked_months', v_months);
end;
$$;
revoke all on function private.migration_post(uuid) from public, anon, authenticated;

/** Stage 9: the whole migration, then everything is put back as it was. Shows what would happen. */
create function public.acct_migration_test(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
  v_out jsonb;
begin
  if v.status = 'migrated' then
    perform private.raise_app_error('CONFLICT', 'migration_done');
  end if;
  if v.prepared_at is null then
    perform private.raise_app_error('CONFLICT', 'migration_not_prepared');
  end if;
  begin
    v_out := private.migration_post(p_id);
    raise exception using errcode = 'P0099', message = 'migration_test_rollback';
  exception when sqlstate 'P0099' then
    null;  -- everything the test did is undone here
  end;
  update public.acct_migrations
     set test_at = now(), test_prepared_at = prepared_at, test_result = v_out,
         status = case when status = 'undone' then 'undone' else 'tested' end
   where id = p_id;
  perform private.migration_log(p_id, 'test', 'Test run (put back): ' || (v_out - 'failures')::text);
  return v_out;
end;
$$;

/** Stage 11: the real run — only after a backup of the books and a test of the same preview. */
create function public.acct_migration_run(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
  v_out jsonb;
begin
  if v.status = 'migrated' then
    perform private.raise_app_error('CONFLICT', 'migration_done');
  end if;
  if not v.target_backup_ok then
    perform private.raise_app_error('CONFLICT', 'migration_needs_backup');
  end if;
  if v.status <> 'tested' or v.test_prepared_at is distinct from v.prepared_at then
    perform private.raise_app_error('CONFLICT', 'migration_needs_test');
  end if;
  delete from public.acct_migration_id_map where migration_id = p_id;
  v_out := private.migration_post(p_id);
  update public.acct_migrations set status = 'migrated', run_at = now(), run_result = v_out where id = p_id;
  perform private.migration_log(p_id, 'production', 'Migrated: ' || (v_out - 'failures')::text);
  return v_out;
end;
$$;

/** Take a run back out: its entries and lines, the accounts it created (when nothing else uses them), the months it locked. */
create function public.acct_migration_undo(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations := private.migration_open(p_id);
  v_entries uuid[];
  v_lines int;
  v_accounts int;
begin
  if v.status <> 'migrated' then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  select coalesce(array_agg(target_id::uuid), '{}') into v_entries from public.acct_migration_id_map where migration_id = p_id and entity = 'entry';
  if exists (select 1 from public.journal_entries e where e.reverses = any (v_entries) or (e.id = any (v_entries) and e.reversed_by is not null)) then
    perform private.raise_app_error('CONFLICT', 'migration_entries_used');
  end if;
  -- Open the months this run locked; any other locked month stops the undo.
  update public.fiscal_periods f set status = 'open', locked_by = null, locked_at = null
    from jsonb_array_elements(coalesce(v.run_result -> 'locked_months', '[]')) x
   where f.year = (x ->> 'year')::int and f.month = (x ->> 'month')::int;
  if exists (select 1 from public.journal_entries e join public.fiscal_periods f
               on f.year = extract(year from e.entry_date)::int and f.month = extract(month from e.entry_date)::int and f.status = 'locked'
              where e.id = any (v_entries)) then
    perform private.raise_app_error('CONFLICT', 'period_locked');
  end if;
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
  perform private.migration_log(p_id, 'undo', 'Run taken back out (' || cardinality(v_entries) || ' entries, ' || v_lines || ' lines, ' || v_accounts || ' accounts): ' || trim(p_reason));
  return jsonb_build_object('entries', cardinality(v_entries), 'lines', v_lines, 'accounts', v_accounts);
end;
$$;

-- ---- Stage 12: checks and reports -----------------------------------------------------------------------------------

/** Old totals against what is in the books now, and the trial balance of the migrated entries. */
create function public.acct_migration_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.acct_migrations;
begin
  perform private.assert_migration_admin();
  select * into v from public.acct_migrations where id = p_id;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'migration');
  end if;
  return jsonb_build_object(
    'source_rows', (select coalesce(sum(row_count), 0) from public.acct_migration_tables where migration_id = p_id),
    'items', (select coalesce(jsonb_object_agg(k, n), '{}') from (select entity || ':' || status as k, count(*) as n from public.acct_migration_items where migration_id = p_id group by 1) s),
    'source_debit', (select coalesce(sum((l ->> 'debit')::numeric), 0) from public.acct_migration_items i, jsonb_array_elements(i.data -> 'lines') l
                      where i.migration_id = p_id and i.entity = 'entry' and i.status <> 'skipped'),
    'source_credit', (select coalesce(sum((l ->> 'credit')::numeric), 0) from public.acct_migration_items i, jsonb_array_elements(i.data -> 'lines') l
                       where i.migration_id = p_id and i.entity = 'entry' and i.status <> 'skipped'),
    'books_debit', (select coalesce(sum(jl.debit), 0) from public.acct_migration_id_map m join public.journal_lines jl on jl.entry_id = m.target_id::uuid
                     where m.migration_id = p_id and m.entity = 'entry'),
    'books_credit', (select coalesce(sum(jl.credit), 0) from public.acct_migration_id_map m join public.journal_lines jl on jl.entry_id = m.target_id::uuid
                      where m.migration_id = p_id and m.entity = 'entry'),
    'books_entries', (select count(*) from public.acct_migration_id_map m join public.journal_entries e on e.id = m.target_id::uuid
                       where m.migration_id = p_id and m.entity = 'entry'),
    'trial', (select coalesce(jsonb_agg(jsonb_build_object('account', s.account, 'name_en', a.name_en, 'name_so', a.name_so, 'debit', s.debit, 'credit', s.credit) order by s.account), '[]')
                from (select jl.account, sum(jl.debit) debit, sum(jl.credit) credit
                        from public.acct_migration_id_map m join public.journal_lines jl on jl.entry_id = m.target_id::uuid
                       where m.migration_id = p_id and m.entity = 'entry' group by jl.account) s
                join public.gl_accounts a on a.code = s.account));
end;
$$;

revoke all on function public.acct_migration_create(jsonb), public.acct_migration_add_table(uuid, jsonb), public.acct_migration_add_rows(uuid, text, int, jsonb),
  public.acct_migration_save(uuid, jsonb), public.acct_migration_set_items(uuid, jsonb, boolean, jsonb), public.acct_migration_backup(uuid),
  public.acct_migration_target_schema(), public.acct_migration_test(uuid), public.acct_migration_run(uuid), public.acct_migration_undo(uuid, text),
  public.acct_migration_report(uuid) from public, anon;
grant execute on function public.acct_migration_create(jsonb), public.acct_migration_add_table(uuid, jsonb), public.acct_migration_add_rows(uuid, text, int, jsonb),
  public.acct_migration_save(uuid, jsonb), public.acct_migration_set_items(uuid, jsonb, boolean, jsonb), public.acct_migration_backup(uuid),
  public.acct_migration_target_schema(), public.acct_migration_test(uuid), public.acct_migration_run(uuid), public.acct_migration_undo(uuid, text),
  public.acct_migration_report(uuid) to authenticated;

-- The old files are kept as they were uploaded (the source backup), readable only by the server.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit) values ('accounting-migrations', 'accounting-migrations', false, 104857600)
  on conflict (id) do nothing;
exception when others then
  null;  -- no storage here (the test database)
end;
$$;
