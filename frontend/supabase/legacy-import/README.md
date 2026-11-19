# Old LRMIS → new LRMIS

How to bring the old LRMIS register (MySQL dump `lrmisdb3`, March 2016) into the new system.

| File | What it does |
|---|---|
| `convert_dump.py` | Reads the MySQL dump and writes `01` and `02`. Run: `python3 -I convert_dump.py "<dump.sql>" .` |
| `01_legacy_schema.sql` | Schema `legacy`: all 47 old tables in PostgreSQL types, with primary keys, RLS on, no API access |
| `02_legacy_data.sql` | All 77,091 old rows as INSERTs (git-ignored: it holds owners' names and phones) |
| `03_stage_migration.sql` | Prepares a job "Old LRMIS 2015-2016 (lrmisdb3)" in **Accounting → Old data migration**, with one item per owner, plot, bill and payment, each `ready`, `error` or `skipped` with the reason |
| `04_checks.sql` | Read-only checks after the run: old totals against new totals |
| `05_run_from_sql_editor.sql` | Backup, Test and Run as a named Super Admin with no time limit (the app's buttons stop after 8 seconds) |
| `../migrations/20261020000253_migration_old_lrmis.sql` | System change the run needs: places plots that have no map location, and keeps more of the old fields |

## Order

1. Apply migration `20261020000253_migration_old_lrmis.sql`, as with every migration.
2. In the Supabase SQL editor (database owner), run `01`, then `02`, then `03`. Step `03` prints how many items are ready.
3. Check the preview in **Accounting → Old data migration → Old LRMIS 2015-2016**.
4. Put the Super Admin's email in `05_run_from_sql_editor.sql` and run step 1 (Backup, Test: must show 0 failures),
   then step 2 (Run). Don't use the Test and Run buttons: the app stops a request after 8 seconds, and ~18,000 records
   take longer (about a minute on the scratch test).
5. Run `04_checks.sql`. If something is wrong, Undo (Migration center or step 4 of `05`), fix the mapping in `03`, and
   run `03` again.

Do not press "Work out again" on this job: it was prepared by SQL, not from uploaded rows. Run `03` again instead.

The PDF report (`LRMIS-Old-Data-Migration-Report.pdf` in the repo root) has the mapping, the gaps, and the decisions
the office still has to make.
