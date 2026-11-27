/**
 * pnpm import-open-buildings <3d5_buildings.csv.gz> [--min-confidence 0.7] [--commit]
 *
 * Loads Google Open Buildings (v3, CC BY-4.0) roof outlines for Banadir into private.building_outlines, so the land
 * form can move the pin to the middle of the roof under it. The file is the S2 tile that covers Mogadishu:
 * https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/3d5_buildings.csv.gz
 * Only roofs whose middle lies inside the Banadir box are kept. Without --commit it only counts; with --commit it
 * loads in batches. To load again, first run `truncate private.building_outlines` in the SQL editor. Uses the
 * service-role key from apps/web/.env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

config({ path: "apps/web/.env.local" });
config({ path: ".env" });

// The Banadir districts' extent (from public.districts), with a little room around it.
const BOX = { west: 45.21, south: 1.96, east: 45.43, north: 2.16 };
const BATCH = 1500;

/** One CSV line into fields (quoted fields may hold commas; geometry is quoted). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const commit = args.includes("--commit");
  const mi = args.indexOf("--min-confidence");
  const minConf = mi >= 0 ? Number(args[mi + 1]) : 0.7;
  if (!file) throw new Error("Usage: pnpm import-open-buildings <3d5_buildings.csv.gz> [--min-confidence 0.7] [--commit]");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (commit && (!url || !key)) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (apps/web/.env.local).");
  const db = commit ? createClient(url!, key!, { auth: { persistSession: false } }) : null;

  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let header: string[] | null = null;
  let seen = 0;
  let kept = 0;
  let loaded = 0;
  let batch: { wkt: string; confidence: number }[] = [];
  const flush = async () => {
    if (!batch.length) return;
    if (db) {
      const { data, error } = await db.rpc("building_outlines_load", { p_rows: batch });
      if (error) throw new Error(`Load failed after ${loaded} roofs: ${error.message}`);
      loaded += Number(data) || 0;
    }
    batch = [];
  };
  for await (const line of lines) {
    if (!header) {
      header = fields(line);
      continue;
    }
    seen++;
    const f = fields(line);
    const lat = Number(f[header.indexOf("latitude")]);
    const lon = Number(f[header.indexOf("longitude")]);
    const conf = Number(f[header.indexOf("confidence")]);
    if (lon < BOX.west || lon > BOX.east || lat < BOX.south || lat > BOX.north || !(conf >= minConf)) continue;
    kept++;
    batch.push({ wkt: f[header.indexOf("geometry")]!, confidence: conf });
    if (batch.length >= BATCH) {
      await flush();
      process.stdout.write(`\r${kept} roofs in Banadir so far (${seen} read)…`);
    }
  }
  await flush();
  console.log(`\nRead ${seen} roofs; ${kept} in Banadir with confidence ≥ ${minConf}.`);
  console.log(commit ? `Loaded ${loaded} into private.building_outlines.` : "Dry run: nothing loaded. Add --commit to load.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
