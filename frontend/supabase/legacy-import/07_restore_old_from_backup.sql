-- Bring back everything deleted on 2026-11-19 (owner's request, 2026-11-28): the old owners and land with their bills,
-- payments, journal, history, certificates, demolitions, applications, transfers and billing runs, exactly as they
-- were, from schema cleanup_20261119. Old queued SMS (messages) are NOT brought back. Automatic rules (triggers) are
-- paused while the rows go in so nothing is created twice (no new bills, journal postings or events); foreign keys still
-- apply. All or nothing: one statement.
do $do$
declare
  t text;
  cols text;
  n bigint;
  tables text[] := array['parties', 'billing_runs', 'applications', 'parcels', 'application_parties', 'parcel_owners', 'surveys',
                         'invoices', 'invoice_lines', 'payments', 'payment_allocations', 'journal_entries', 'journal_lines',
                         'parcel_history', 'demolitions', 'transfers', 'issued_documents'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  foreach t in array tables loop
    select string_agg(quote_ident(b.column_name), ', ' order by b.ordinal_position) into cols
      from information_schema.columns b
      join information_schema.columns p on p.table_schema = 'public' and p.table_name = b.table_name and p.column_name = b.column_name
     where b.table_schema = 'cleanup_20261119' and b.table_name = t and p.is_generated = 'NEVER' and p.is_identity = 'NO';
    -- Identity columns (bigint ids) keep their old values too.
    select string_agg(quote_ident(b.column_name), ', ' order by b.ordinal_position) into cols
      from information_schema.columns b
      join information_schema.columns p on p.table_schema = 'public' and p.table_name = b.table_name and p.column_name = b.column_name
     where b.table_schema = 'cleanup_20261119' and b.table_name = t and p.is_generated = 'NEVER';
    execute format('insert into public.%I (%s) overriding system value select %s from cleanup_20261119.%I', t, cols, cols, t);
    get diagnostics n = row_count;
    raise notice '% restored: %', t, n;
  end loop;
  foreach t in array tables loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end;
$do$;
