-- ============================================================================================================
-- Old LRMIS → new LRMIS: prepare one migration in the Migration center (Accounting → Old data migration).
--
-- Reads the old rows in schema `legacy` (01 + 02) and writes one acct_migrations job with its items:
--   owner   one per published old owner                      (legacy.land_owners)
--   land    one per published old parcel                     (legacy.land_parcels + land_units)
--   bill    one per land, fee and year                       (legacy.dr_trans type 1 + invoice_list)
--   payment one per published old payment                    (legacy.dr_trans type 2)
-- Nothing in the new system's own records is touched here. The new records (UUIDs, PUNs, account numbers, invoice and
-- receipt numbers, links between them) are made by the system itself when a Super Admin presses Backup → Test → Run
-- on the job, and Undo takes them all back out. Each item is `ready`, `error` (with why) or `skipped` (with why).
--
-- Old money is in Somali shillings: every amount is divided by the exchange rate stored on its own old row
-- (22,000 or 23,000 SOS per USD) and rounded to cents; the shilling amount and the rate are kept in the note.
--
-- Run as the database owner (Supabase SQL editor) after 01_legacy_schema.sql and 02_legacy_data.sql.
-- Safe to run again: it replaces the job's items while the job has not been run.
-- ============================================================================================================

begin;

-- ---- Mappings (old value → new value). Change here if the office decides otherwise. ----------------------------------

create temporary table map_grade (old_id bigint primary key, code text not null) on commit drop;
insert into map_grade values
  (1, 'warehouse'),     -- Empty Land              → "Empty Land" (code warehouse)
  (2, 'villa'),         -- Wall Fenced Villa       → Villa
  (3, 'storey'),        -- Storey Building         → Storey building
  (4, 'villa'),         -- Wall Fenced Villa (old copy, switched off) → Villa
  (5, 'brick_house'),   -- Brick/Stone House       → Brick house
  (6, 'cariish'),       -- Cariish/Baraako/Jiingad → Cariish
  (7, 'cariish');       -- cariish (switched off)  → Cariish

create temporary table map_fee (gl_code text primary key, fee_code text not null) on commit drop;
insert into map_fee values
  ('200-01', 'property_bill'),     -- Land Tax A/C          → Tax bill
  ('200-02', 'id_card_print'),     -- Card Fee A/C          → ID card print
  ('200-03', 'registration_fee');  -- Registration Fee A/C  → New registration fee

-- Phone numbers: +252 and nine digits; anything else is left out (and said so in the item's message).
create or replace function pg_temp.phone(p text) returns text language sql immutable as $$
  select case
    when d ~ '^252[0-9]{9}$' then '+' || d
    when d ~ '^0[0-9]{9}$' then '+252' || substr(d, 2)
    when d ~ '^[0-9]{9}$' then '+252' || d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- "N/A", "NA", "-", "0", "none", "" mean nothing.
create or replace function pg_temp.val(p text) returns text language sql immutable as $$
  select case when upper(regexp_replace(coalesce(p, ''), '[\s./\\-]', '', 'g')) in ('', 'NA', 'N', 'NONE', '0', 'NIL') then null
              else regexp_replace(trim(p), '\s+', ' ', 'g') end;
$$;

-- Old block code → our neighbourhood code (SBCDKW1 → SBCDKW01).
create or replace function pg_temp.block(p text) returns text language sql immutable as $$
  select case when x ~ '^[A-Z]{6}[0-9]$' then left(x, 6) || '0' || right(x, 1) else x end
  from (select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) as x) s;
$$;

-- An old amount in shillings → US dollars at the row's own rate.
create or replace function pg_temp.usd(p_sos numeric, p_rate numeric) returns numeric language sql immutable as $$
  select round(p_sos / nullif(p_rate, 0), 2);
$$;

-- ---- The job --------------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.acct_migrations where name = 'Old LRMIS 2015-2016 (lrmisdb3)' and status = 'migrated') then
    raise exception 'The old LRMIS data has already been migrated. Undo that run in the Migration center first.';
  end if;
  if not exists (select 1 from legacy._source) then
    raise exception 'Load 01_legacy_schema.sql and 02_legacy_data.sql first.';
  end if;
end;
$$;

insert into public.acct_migrations (name, source_kind, source_files, source_backup_at, source_backup_ok, table_map, created_by)
select 'Old LRMIS 2015-2016 (lrmisdb3)', 'sql',
       jsonb_build_array(jsonb_build_object('name', s.file_name, 'sha256', s.sha256, 'path', 'database schema "legacy"')),
       s.converted_at, true, '{}'::jsonb,
       (select p.user_id from public.profiles p
         where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null and private.user_grants_all(p.user_id)
         order by p.created_at limit 1)
  from (select * from legacy._source order by converted_at desc limit 1) s
 where not exists (select 1 from public.acct_migrations where name = 'Old LRMIS 2015-2016 (lrmisdb3)');

create temporary table job on commit drop as
select id from public.acct_migrations where name = 'Old LRMIS 2015-2016 (lrmisdb3)' order by created_at desc limit 1;

delete from public.acct_migration_items where migration_id = (select id from job);
delete from public.acct_migration_tables where migration_id = (select id from job);

-- The old tables, as the Migration center shows them (structure and row counts).
insert into public.acct_migration_tables (migration_id, name, columns, primary_key, row_count)
select (select id from job), c.table_name,
       jsonb_agg(jsonb_build_object('name', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable = 'YES') order by c.ordinal_position),
       coalesce((select array_agg(k.column_name::text order by k.ordinal_position)
                   from information_schema.table_constraints tc
                   join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
                  where tc.table_schema = 'legacy' and tc.table_name = c.table_name and tc.constraint_type = 'PRIMARY KEY'), '{}'),
       coalesce(((select row_counts from legacy._source order by converted_at desc limit 1) ->> c.table_name)::int, 0)
  from information_schema.columns c
 where c.table_schema = 'legacy' and c.table_name not like '\_%'
 group by c.table_name;

-- ---- Owners ---------------------------------------------------------------------------------------------------------

insert into public.acct_migration_items (migration_id, entity, source_key, data, status, message)
select (select id from job), 'owner', 'O-' || o.id,
       jsonb_strip_nulls(jsonb_build_object(
         'full_name', regexp_replace(trim(o.full_names), '\s+', ' ', 'g'),
         'phone', pg_temp.phone(o.telephone),
         'nationality', coalesce(c.iso, case when upper(trim(o.citizenship)) in ('SOMALIA', 'SOMALI', '') then 'SO' end),
         'id_number', pg_temp.val(o.personal_id),
         'id_type', case when pg_temp.val(o.personal_id) is not null then 'national_id' end,
         -- Placeholder emails typed to fill the box (sb@s.com, 123@123.com, …) are left out: shared by 3+ owners or a made-up domain.
         'email', case when pg_temp.val(o.email_address) ~ '^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$'
                        and lower(split_part(o.email_address, '@', 2)) not in ('s.com', 'a.com', 'g.com', 'sb.com', '123.com', 'm.a', 'n.a', 'na.com', 'x.com')
                        and (select count(*) from legacy.land_owners e where lower(trim(e.email_address)) = lower(trim(o.email_address))) < 3
                       then lower(pg_temp.val(o.email_address)) end,
         'address', pg_temp.val(o.physical_address),
         'next_of_kin', nullif(jsonb_strip_nulls(jsonb_build_object('name', pg_temp.val(o.next_of_kin),
                                                                    'phone', pg_temp.phone(o.next_of_kin_telephone))), '{}'::jsonb))),
       case when length(regexp_replace(trim(o.full_names), '\s+', ' ', 'g')) < 3 then 'error' else 'ready' end,
       nullif(concat_ws('; ',
         case when length(regexp_replace(trim(o.full_names), '\s+', ' ', 'g')) < 3 then 'name too short: "' || o.full_names || '"' end,
         case when pg_temp.phone(o.telephone) is null and pg_temp.val(o.telephone) is not null then 'phone "' || o.telephone || '" is not a Somali number, left out' end,
         case when pg_temp.val(o.image_url) is not null then 'old photo ' || o.image_url || ' is not in the dump' end), '')
  from legacy.land_owners o
  left join legacy.country c on upper(c.nicename) = upper(trim(o.citizenship)) or upper(c.name) = upper(trim(o.citizenship))
 where o.publish = 1;

-- ---- Land -----------------------------------------------------------------------------------------------------------

create temporary table old_land on commit drop as
select p.*,
       pg_temp.block(coalesce(nullif(trim(p.zone_name), ''), z.zone_name)) as block,
       n.id as nbhd_id,
       (select g.code from legacy.land_units u join map_grade g on g.old_id = u.unit_type_id
         where u.parcel_id = p.id and u.publish = 1
         order by (u.unit_type_id = 1), u.total_tax_amount desc, u.id limit 1) as grade,
       (select jsonb_agg(jsonb_build_object('type', u.unit_type_name, 'width', u.width, 'length', u.length, 'height', u.height,
                                            'tax_sos', u.total_tax_amount) order by u.id)
          from legacy.land_units u where u.parcel_id = p.id and u.publish = 1) as units
  from legacy.land_parcels p
  left join legacy.zones z on z.id = p.zone_id
  left join lateral (select n.id from public.neighbourhoods n
                      where n.code = pg_temp.block(coalesce(nullif(trim(p.zone_name), ''), z.zone_name)) and n.deleted_at is null
                      order by n.created_at limit 1) n on true
 where p.publish = 1;

insert into public.acct_migration_items (migration_id, entity, source_key, data, status, message)
select (select id from job), 'land', 'L-' || p.id,
       jsonb_strip_nulls(jsonb_build_object(
         'owner_key', 'O-' || p.owner_id,
         'neighbourhood_id', p.nbhd_id,
         'house_no', h.house_no,
         'plot_no', pg_temp.val(p.plot_house_number),
         'width', nullif(p.parcel_width, 0),
         'length', nullif(p.parcel_length, 0),
         'area', nullif(coalesce(nullif(p.parcel_size, 0), p.parcel_width * p.parcel_length), 0),
         'property_type', p.grade,
         'land_use', case p.parcel_type when 2 then 'commercial' when 3 then 'state' else 'residential' end,
         'ownership', case p.ownership when 1 then 'public' else 'private' end,
         'developed', case p.developed when 1 then true when 2 then false end,
         'deed_no', pg_temp.val(p.deed_no),
         'govt_file_no', pg_temp.val(p.goverment_file_number),
         'govt_receipt_no', pg_temp.val(p.goverment_receipt_number),
         'registered_at', coalesce(p.date_registered, p.date_created::date),
         'legacy_account', pg_temp.val(p.account_number),
         'old', jsonb_strip_nulls(jsonb_build_object(
           'plot_house_number', p.plot_house_number, 'block', p.block, 'street', pg_temp.val(p.street_name),
           'owner_name', p.owner_name, 'owner_type', p.owner_type, 'tenure_acquired', p.tenure_acquisition_date,
           'units', p.units, 'invoice', pg_temp.val(p.inv_reference), 'entered_by', p.user_id, 'entered_at', p.date_created)))),
       case when p.nbhd_id is null then 'error'
            when p.is_approved <> 1 then 'skipped'
            else 'ready' end,
       nullif(concat_ws('; ',
         case when p.nbhd_id is null then 'block ' || coalesce(nullif(p.block, ''), '(none)') || ' is not a neighbourhood in the new system' end,
         case when p.is_approved <> 1 then 'not approved in the old system' end,
         case when p.grade is null then 'no house type in the old record' end,
         case when coalesce(p.parcel_width, 0) * coalesce(p.parcel_length, 0) = 0 then 'no size in the old record' end), '')
  from old_land p
  cross join lateral (
    -- The old "plot/house number" is mostly the block (with or without its 2-letter district) and the house number.
    select coalesce(nullif(ltrim(case
             when upper(p.plot_house_number) like p.block || '%' then substr(p.plot_house_number, length(p.block) + 1)
             when length(p.block) = 8 and upper(p.plot_house_number) like substr(p.block, 3) || '%' then substr(p.plot_house_number, length(p.block) - 1)
           end, '0'), ''), pg_temp.val(p.plot_house_number)) as house_no
  ) h;

-- ---- Bills: one per land, fee and year (two open bills of one kind in one year are refused, so copies are added up) ----

create temporary table old_bill_lines on commit drop as
select t.id as trans_id, t.parcel_id, t.reference_no, t.transaction_date, t.date_due, t.exchange_rate,
       l.gl_account_code, l.amount
  from legacy.dr_trans t
  join lateral (
    select x.gl_account_code, x.amount from legacy.invoice_list x
     where x.reference_no = t.reference_no and x.publish = 1 and x.date_created = t.date_created
    union all
    -- No lines kept for this copy of the bill: the bill's own total, as land tax.
    select '200-01', t.amount
     where not exists (select 1 from legacy.invoice_list x where x.reference_no = t.reference_no and x.publish = 1 and x.date_created = t.date_created)
  ) l on true
 where t.transaction_type = 1 and t.publish = 1;

insert into public.acct_migration_items (migration_id, entity, source_key, data, status, message)
select (select id from job), 'bill', 'B-' || b.parcel_id || '-' || f.fee_code || '-' || b.yr,
       jsonb_build_object(
         'land_key', 'L-' || b.parcel_id,
         'fee_code', f.fee_code,
         'year', b.yr,
         'amount', b.usd,
         'issue_date', b.issued,
         'due_date', greatest(b.due, b.issued),
         'ref', b.refs,
         'note', 'Old bill ' || b.refs || ': ' || to_char(b.sos, 'FM999,999,999,990') || ' SOS at ' || b.rates || ' SOS per USD'),
       case when li.status = 'ready' then 'ready' else 'skipped' end,
       case when li.status is null then 'its land is not in the old register (deleted)'
            when li.status <> 'ready' then 'its land is not brought in (' || li.status || ')' end
  from (
    select l.parcel_id, l.gl_account_code, extract(year from coalesce(min(l.transaction_date), current_date))::int as yr,
           sum(pg_temp.usd(l.amount, l.exchange_rate)) as usd, sum(l.amount) as sos,
           string_agg(distinct l.reference_no, ', ') as refs, string_agg(distinct l.exchange_rate::text, '/') as rates,
           min(l.transaction_date) as issued, max(l.date_due) as due
      from old_bill_lines l
     group by l.parcel_id, l.gl_account_code, extract(year from l.transaction_date)
  ) b
  join map_fee f on f.gl_code = b.gl_account_code
  left join public.acct_migration_items li on li.migration_id = (select id from job) and li.entity = 'land' and li.source_key = 'L-' || b.parcel_id
 where b.usd > 0;

-- ---- Payments ---------------------------------------------------------------------------------------------------------

insert into public.acct_migration_items (migration_id, entity, source_key, data, status, message)
select (select id from job), 'payment', 'P-' || t.id,
       jsonb_strip_nulls(jsonb_build_object(
         'land_key', 'L-' || t.parcel_id,
         'date', d.paid_on,
         'amount', pg_temp.usd(t.amount, t.exchange_rate),
         'method', case t.mode_of_payment when 2 then 'cheque' when 3 then 'mobile_money' else 'cash' end,
         'payer_name', o.full_names,
         'payer_phone', pg_temp.phone(t.telephone),
         'ref', t.reference_no,
         'note', concat_ws('; ',
           'Old payment ' || t.reference_no || ' for ' || t.invoice_no || ': ' || to_char(t.amount, 'FM999,999,999,990') || ' SOS at ' || t.exchange_rate,
           'government receipt ' || pg_temp.val(t.goverment_receipt_number),
           'service charge receipt ' || pg_temp.val(t.service_charge_receipt_no),
           case when d.fixed then 'old date ' || coalesce(t.transaction_date::text, 'empty') || ' replaced by the day it was entered' end))),
       case when li.status = 'ready' and t.amount > 0 then 'ready' else 'skipped' end,
       case when t.amount <= 0 then 'no amount'
            when li.status is null then 'its land is not in the old register (deleted)'
            when li.status <> 'ready' then 'its land is not brought in (' || li.status || ')' end
  from legacy.dr_trans t
  left join legacy.land_owners o on o.id = t.debtor_id
  cross join lateral (
    -- A few old payments carry impossible days (0201, 2105, 1968 …): the day the payment was entered is used instead.
    select case when t.transaction_date between date '2014-01-01' and t.date_created::date + 1 then t.transaction_date else t.date_created::date end as paid_on,
           not coalesce(t.transaction_date between date '2014-01-01' and t.date_created::date + 1, false) as fixed
  ) d
  left join public.acct_migration_items li on li.migration_id = (select id from job) and li.entity = 'land' and li.source_key = 'L-' || t.parcel_id
 where t.transaction_type = 2 and t.publish = 1;

-- ---- Summary for the Migration center -------------------------------------------------------------------------------

update public.acct_migrations m
   set prepared_at = now(),
       status = case when m.status = 'undone' then 'undone' else 'draft' end,
       grade_map = (select jsonb_object_agg(old_id::text, code) from map_grade),
       fee_map = (select jsonb_object_agg(gl_code, fee_code) from map_fee),
       prepared_summary = jsonb_build_object(
         'accounts', '{}'::jsonb, 'entries', '{}'::jsonb, 'lines', 0, 'debit', 0, 'credit', 0,
         'owners', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.acct_migration_items where migration_id = m.id and entity = 'owner' group by 1) s),
         'land', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.acct_migration_items where migration_id = m.id and entity = 'land' group by 1) s),
         'bills', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.acct_migration_items where migration_id = m.id and entity = 'bill' group by 1) s),
         'payments', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.acct_migration_items where migration_id = m.id and entity = 'payment' group by 1) s),
         'warnings', jsonb_build_array(
           'Prepared by SQL from schema "legacy" (03_stage_migration.sql). Do not press "Work out again": run the script again instead.',
           'Old amounts were in Somali shillings and are brought in as US dollars at each row''s own rate.',
           'No old plot has a map location: every plot is placed near its sector or section and marked "location to check".'))
 where m.id = (select id from job);

insert into public.acct_migration_log (migration_id, stage, message)
select id, 'preview', 'Prepared from schema legacy by 03_stage_migration.sql' from job;

-- What was prepared.
select entity, status, count(*) as items,
       round(sum(case when entity in ('bill', 'payment') then (data ->> 'amount')::numeric end), 2) as usd
  from public.acct_migration_items where migration_id = (select id from job)
 group by entity, status order by entity, status;

commit;
