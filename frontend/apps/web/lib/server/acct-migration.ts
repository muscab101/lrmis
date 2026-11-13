import "server-only";
import type { AccountMap, ColumnMap, TableTarget } from "@/lib/migration/prepare";
import type { Row, SourceColumn } from "@/lib/migration/source";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** Where uploaded old files are kept, as they came (the source backup). */
export const MIGRATION_BUCKET = "accounting-migrations";

export type MigrationStatus = "draft" | "tested" | "migrated" | "undone";

export interface Migration {
  id: string;
  name: string;
  status: MigrationStatus;
  source_kind: "sql" | "csv";
  source_files: { name: string; path: string; bytes: number; sha256: string }[];
  source_backup_at: string | null;
  source_backup_ok: boolean;
  target_backup_at: string | null;
  target_backup_ok: boolean;
  table_map: Record<string, TableTarget>;
  column_map: ColumnMap;
  account_map: AccountMap;
  district_map: Record<string, string>;
  neighbourhood_map: Record<string, string>;
  grade_map: Record<string, string>;
  fee_map: Record<string, string>;
  options: { lock_months?: boolean };
  prepared_at: string | null;
  prepared_summary: {
    accounts: Record<string, number>;
    entries: Record<string, number>;
    lines: number;
    debit: number;
    credit: number;
    owners?: Record<string, number>;
    land?: Record<string, number>;
    bills?: Record<string, number>;
    payments?: Record<string, number>;
    warnings?: string[];
  } | null;
  test_at: string | null;
  test_prepared_at: string | null;
  test_result: RunResult | null;
  run_at: string | null;
  run_result: RunResult | null;
  undone_at: string | null;
  created_at: string;
}

export interface RunResult {
  accounts_created: number;
  accounts_mapped: number;
  entries: number;
  failed: number;
  skipped: number;
  failures: { entity: string; key: string; message: string }[];
  debit: number;
  credit: number;
  locked_months: { year: number; month: number }[];
  owners_created?: number;
  owners_matched?: number;
  land?: number;
  bills?: number;
  payments?: number;
  demolished?: number;
  to_check?: number;
}

export interface MigrationTable {
  name: string;
  columns: SourceColumn[];
  primary_key: string[];
  foreign_keys: { columns: string[]; ref_table: string; ref_columns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  row_count: number;
  stats: { nulls: Record<string, number>; duplicates: number };
}

export interface MigrationItem {
  entity: "account" | "entry" | "owner" | "land" | "bill" | "payment";
  source_key: string;
  status: "ready" | "error" | "skipped" | "migrated" | "failed";
  message: string | null;
  data: Record<string, unknown>;
}

const COLS =
  "id, name, status, source_kind, source_files, source_backup_at, source_backup_ok, target_backup_at, target_backup_ok, table_map, column_map, account_map, district_map, neighbourhood_map, grade_map, fee_map, options, prepared_at, prepared_summary, test_at, test_prepared_at, test_result, run_at, run_result, undone_at, created_at";

export async function listMigrations() {
  const supabase = await createClient();
  return unwrap(await supabase.from("acct_migrations").select(COLS).order("created_at", { ascending: false }).limit(100), "migrations") as Migration[];
}

export async function getMigration(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  return unwrap(await supabase.from("acct_migrations").select(COLS).eq("id", id).maybeSingle(), "migration") as Migration | null;
}

export async function migrationTables(id: string) {
  const supabase = await createClient();
  return unwrap(
    await supabase.from("acct_migration_tables").select("name, columns, primary_key, foreign_keys, indexes, row_count, stats").eq("migration_id", id).order("name"),
    "migration tables",
  ) as MigrationTable[];
}

/** Old rows of the chosen tables (all of them, a page at a time). */
export async function migrationRows(id: string, tables: string[], limit = 200_000): Promise<Record<string, Row[]>> {
  const supabase = await createClient();
  const out: Record<string, Row[]> = Object.fromEntries(tables.map((t) => [t, []]));
  for (const t of tables) {
    for (let from = 0; from < limit; from += 1000) {
      const page = unwrap(
        await supabase.from("acct_migration_rows").select("data").eq("migration_id", id).eq("table_name", t).order("row_no").range(from, from + 999),
        "migration rows",
      ) as { data: Row }[];
      out[t]!.push(...page.map((p) => p.data));
      if (page.length < 1000) break;
    }
  }
  return out;
}

/** A few rows of one old table, to look at. */
export async function sampleRows(id: string, table: string, n = 10) {
  const supabase = await createClient();
  return (
    unwrap(await supabase.from("acct_migration_rows").select("data").eq("migration_id", id).eq("table_name", table).order("row_no").limit(n), "sample rows") as { data: Row }[]
  ).map((r) => r.data);
}

export async function migrationItems(id: string, status: MigrationItem["status"] | null, entity: MigrationItem["entity"] | null, limit = 300) {
  const supabase = await createClient();
  let q = supabase.from("acct_migration_items").select("entity, source_key, status, message, data").eq("migration_id", id);
  if (status) q = q.eq("status", status);
  if (entity) q = q.eq("entity", entity);
  return unwrap(await q.order("entity").order("source_key").limit(limit), "migration items") as MigrationItem[];
}

/** How many records of each kind are in each state ("entity:status" → count). */
export async function itemCounts(id: string) {
  const supabase = await createClient();
  const rep = unwrap(await supabase.rpc("acct_migration_report", { p_id: id }), "migration counts") as { items: Record<string, number> };
  return rep.items ?? {};
}

export async function migrationLog(id: string) {
  const supabase = await createClient();
  return unwrap(
    await supabase.from("acct_migration_log").select("id, at, stage, message").eq("migration_id", id).order("at", { ascending: false }).limit(100),
    "migration log",
  ) as { id: number; at: string; stage: string; message: string }[];
}

export async function migrationBackups(id: string) {
  const supabase = await createClient();
  return unwrap(await supabase.from("acct_migration_backups").select("table_name, row_count, taken_at").eq("migration_id", id).order("table_name"), "backups") as {
    table_name: string;
    row_count: number;
    taken_at: string;
  }[];
}

export interface TargetTable {
  table: string;
  rows: number;
  columns: { name: string; type: string; required: boolean; default: string | null }[];
  constraints: { name: string; kind: string; def: string }[];
}

export async function targetSchema() {
  const supabase = await createClient();
  return (unwrap(await supabase.rpc("acct_migration_target_schema"), "target schema") ?? []) as TargetTable[];
}

export interface MigrationReport {
  source_rows: number;
  items: Record<string, number>;
  source_debit: number;
  source_credit: number;
  books_debit: number;
  books_credit: number;
  books_entries: number;
  trial: { account: string; name_en: string; name_so: string; debit: number; credit: number }[];
}

export async function migrationReport(id: string) {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("acct_migration_report", { p_id: id }), "migration report") as MigrationReport;
}

/** Our chart of accounts and districts, for the ID mapping. */
export async function mappingTargets() {
  const supabase = await createClient();
  const [a, d, j, g, f] = await Promise.all([
    supabase.from("gl_accounts").select("code, name_so, name_en, type, active").order("code"),
    supabase.from("districts").select("id, code, name_so, name_en").is("deleted_at", null).order("name_en"),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }),
    supabase.from("property_grades").select("code, name_so, name_en").eq("active", true).order("sort"),
    supabase.from("fee_types").select("code, name_so, name_en").order("sort"),
  ]);
  return {
    accounts: (a.data ?? []) as { code: string; name_so: string; name_en: string; type: string; active: boolean }[],
    districts: (d.data ?? []) as { id: string; code: string; name_so: string; name_en: string }[],
    journalEntries: j.count ?? 0,
    grades: (g.data ?? []) as { code: string; name_so: string; name_en: string }[],
    fees: (f.data ?? []) as { code: string; name_so: string; name_en: string }[],
  };
}
