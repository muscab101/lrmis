// Loads the old rows into the live legacy.* tables through the temporary function public.legacy_load, using the app's
// service key from .env.local (never printed). Use when there is no direct database password (no psql, no 02 file run).
//
//   python3 -I convert_dump.py "<dump.sql>" . --json <json folder>
//   node load_via_api.mjs <path to apps/web/.env.local> <json folder>
//
// Prints each table's count and "TOTAL 77091" at the end. Stops at the first error and says which table.
import { readFileSync, readdirSync } from "node:fs";

const [envPath, dir] = process.argv.slice(2);
if (!envPath || !dir) {
  console.error("usage: node load_via_api.mjs <.env.local> <json folder>");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in", envPath);
  process.exit(1);
}

async function send(table, rows) {
  const r = await fetch(`${url}/rest/v1/rpc/legacy_load`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_table: table, p_rows: rows }),
  });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return Number(await r.text());
}

let total = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_source.json").sort()) {
  const table = f.slice(0, -5);
  const rows = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  let stored = 0;
  for (let i = 0; i < rows.length; i += 1000) stored += await send(table, rows.slice(i, i + 1000));
  if (stored !== rows.length) throw new Error(`${table}: sent ${rows.length}, stored ${stored}`);
  total += stored;
  if (rows.length) console.log(table.padEnd(28), stored);
}
const src = JSON.parse(readFileSync(`${dir}/_source.json`, "utf8"));
await send("_source", [{ file_name: src.file_name, sha256: src.sha256, converted_at: new Date().toISOString(), row_counts: src.row_counts }]);
console.log("TOTAL", total);
