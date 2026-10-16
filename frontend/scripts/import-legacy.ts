/**
 * pnpm import-legacy <file.csv> --actor <staff email> [--batch <name>] [--commit]
 *
 * Imports legacy land records (one row per plot) as draft office applications with their
 * owner, so each goes through survey → verification → notice → registration. Without
 * --commit it is a dry run: every row is validated and nothing is written. A report CSV is
 * written next to the input either way. Re-running a committed file is safe (rows are keyed
 * by legacy_ref). Uses the service-role key from apps/web/.env.local.
 *
 * Columns (header row, any order): legacy_ref, full_name, mother_name, gender, phone, id_type,
 * id_number, district_code, neighbourhood_code, lon, lat, plot_no, old_deed_no, govt_file_no,
 * address_note. See docs/samples/legacy-import.csv.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";

config({ path: "apps/web/.env.local" });
config({ path: ".env" });

const COLUMNS = ["legacy_ref", "full_name", "mother_name", "gender", "phone", "id_type", "id_number", "district_code", "neighbourhood_code", "lon", "lat", "plot_no", "old_deed_no", "govt_file_no", "address_note"];

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const commit = args.includes("--commit");
  const actorEmail = flag("actor")?.toLowerCase();
  const batch = flag("batch") ?? new Date().toISOString().slice(0, 10);
  if (!file || !actorEmail) {
    console.error("Usage: pnpm import-legacy <file.csv> --actor <staff email> [--batch <name>] [--commit]");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set (apps/web/.env.local).");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: actor } = await admin.from("profiles").select("user_id, status, kind").eq("email", actorEmail).maybeSingle();
  if (!actor || actor.kind !== "staff" || actor.status !== "active") {
    console.error(`✗ ${actorEmail} is not an active staff account.`);
    process.exit(1);
  }

  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"));
  if (!header) {
    console.error("✗ The file is empty.");
    process.exit(1);
  }
  const cols = header.map((h) => h.trim().toLowerCase());
  const unknown = cols.filter((c) => !COLUMNS.includes(c));
  if (unknown.length) console.warn(`! Ignoring unknown columns: ${unknown.join(", ")}`);
  for (const need of ["legacy_ref", "full_name", "district_code"]) {
    if (!cols.includes(need)) {
      console.error(`✗ Missing required column: ${need}`);
      process.exit(1);
    }
  }

  console.log(`${commit ? "Importing" : "Dry run of"} ${rows.length} rows as ${actorEmail} (batch ${batch})…`);
  const tally: Record<string, number> = {};
  const report: string[] = [["row", "legacy_ref", "status", "application", "problems"].map(csvCell).join(",")];
  for (const [i, r] of rows.entries()) {
    const p = Object.fromEntries(cols.map((c, j) => [c, (r[j] ?? "").trim()]).filter(([c]) => COLUMNS.includes(c as string)));
    const { data, error } = await admin.rpc("legacy_import_row", { p, p_actor: actor.user_id, p_batch: batch, p_dry: !commit });
    const res = error ? { status: "error", problems: [error.message] } : (data as { status: string; number?: string; problems?: string[] });
    tally[res.status] = (tally[res.status] ?? 0) + 1;
    report.push([i + 2, p.legacy_ref, res.status, res.number ?? "", (res.problems ?? []).join("; ")].map(csvCell).join(","));
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1} / ${rows.length}`);
  }
  const out = file.replace(/\.csv$/i, "") + `.report-${commit ? "commit" : "dry"}.csv`;
  writeFileSync(out, "﻿" + report.join("\r\n"));
  console.log(Object.entries(tally).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
  console.log(`Report: ${out}`);
  if (!commit && !tally.invalid && !tally.error) console.log("Looks clean. Run again with --commit to import.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
