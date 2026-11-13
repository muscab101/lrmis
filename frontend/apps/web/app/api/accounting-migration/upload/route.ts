import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ENTITIES, suggestColumns, suggestTable, type ColumnMap, type TableTarget } from "@/lib/migration/prepare";
import { parseCsv, parseMysqlDump, type SourceTable } from "@/lib/migration/source";
import { MIGRATION_BUCKET } from "@/lib/server/acct-migration";
import { getViewer } from "@/lib/server/auth";
import { log } from "@/lib/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const MAX_BYTES = 100 * 1024 * 1024;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * Accounting → Migration, stage 1: the old database file(s). One MySQL .sql dump, or CSV files (one table each).
 * Each file is kept exactly as uploaded (the source backup, checked by reading it back), then read into staging tables.
 * Nothing in the file is ever run.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.isSuperAdmin) return NextResponse.json({ error: "PERMISSION_DENIED" }, { status: 403 });
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (name.length < 2) return NextResponse.json({ error: "name" }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: "files" }, { status: 400 });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES) return NextResponse.json({ error: "too_big" }, { status: 400 });
  const sql = files.filter((f) => /\.sql$/i.test(f.name));
  const csv = files.filter((f) => /\.(csv|txt)$/i.test(f.name));
  if (sql.length + csv.length !== files.length || (sql.length && csv.length) || sql.length > 1) {
    return NextResponse.json({ error: "file_kind" }, { status: 400 });
  }
  const kind = sql.length ? "sql" : "csv";

  // Read every file, and keep it unchanged in storage; reading it back must give the same fingerprint.
  const admin = await createAdminClient();
  const folder = randomUUID();
  const kept: { name: string; path: string; bytes: number; sha256: string }[] = [];
  const tables: SourceTable[] = [];
  let backupOk = true;
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const hash = sha256(buf);
    const path = `${folder}/${f.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await admin.storage.from(MIGRATION_BUCKET).upload(path, buf, { contentType: "application/octet-stream", upsert: false });
    if (up.error) {
      backupOk = false;
      log("warn", "acct_migration.keep_failed", { error: up.error.message });
    } else {
      const back = await admin.storage.from(MIGRATION_BUCKET).download(path);
      backupOk &&= !back.error && sha256(Buffer.from(await back.data!.arrayBuffer())) === hash;
    }
    kept.push({ name: f.name, path, bytes: f.size, sha256: hash });
    const text = buf.toString("utf8");
    if (kind === "sql") tables.push(...parseMysqlDump(text));
    else tables.push(parseCsv(f.name, text));
  }
  if (tables.length === 0) return NextResponse.json({ error: "no_tables" }, { status: 400 });

  const supabase = await createClient();
  const created = await supabase.rpc("acct_migration_create", {
    p: { name, source_kind: kind, source_files: kept, source_backup_ok: backupOk },
  });
  if (created.error) return NextResponse.json({ error: created.error.message }, { status: 400 });
  const id = created.data as string;
  for (const t of tables) {
    const { rows, ...meta } = t;
    const r = await supabase.rpc("acct_migration_add_table", { p_id: id, p: meta });
    if (r.error) return NextResponse.json({ error: r.error.message, id }, { status: 400 });
    for (let i = 0; i < rows.length; i += 2000) {
      const b = await supabase.rpc("acct_migration_add_rows", { p_id: id, p_table: t.name, p_start: i + 1, p_rows: rows.slice(i, i + 2000) });
      if (b.error) return NextResponse.json({ error: b.error.message, id }, { status: 400 });
    }
  }

  // First guesses for the table and column mapping (the admin checks and changes them).
  const tableMap: Record<string, TableTarget> = Object.fromEntries(tables.map((t) => [t.name, suggestTable(t.name, t.columns.map((c) => c.name))]));
  const columnMap: ColumnMap = {};
  for (const e of ENTITIES) {
    const cols = [...new Set(tables.filter((t) => tableMap[t.name] === e).flatMap((t) => t.columns.map((c) => c.name)))];
    if (cols.length) columnMap[e] = suggestColumns(e, cols);
  }
  await supabase.rpc("acct_migration_save", { p_id: id, p: { table_map: tableMap, column_map: columnMap } });
  log("info", "acct_migration.uploaded", { id, kind, tables: tables.length, rows: tables.reduce((s, t) => s + t.row_count, 0) });
  return NextResponse.json({ id });
}
