import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./harness";

const MIGRATIONS = join(__dirname, "..", "migrations");
let db: PGlite;

beforeAll(async () => {
  db = await createDb();
});

describe("RLS policies", () => {
  // PGlite lets every role execute every function, Supabase doesn't: a policy that calls a
  // private function nobody granted to `authenticated` passes here and fails in production.
  it("only call private functions that are explicitly granted to authenticated", async () => {
    const sql = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
    const granted = new Set<string>();
    for (const m of sql.matchAll(/grant execute on function([\s\S]*?)to ([^;]+);/gi)) {
      if (!/\bauthenticated\b/.test(m[2]!)) continue;
      for (const f of m[1]!.matchAll(/private\.([a-z_]+)\s*\(/g)) granted.add(f[1]!);
    }
    const { rows } = await db.query<{ name: string; qual: string }>(
      `select tablename || '.' || policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as qual from pg_policies where schemaname = 'public'`,
    );
    const offenders = rows.flatMap((r) => [...r.qual.matchAll(/private\.([a-z_]+)\(/g)].map((m) => m[1]!).filter((fn) => !granted.has(fn)).map((fn) => `${r.name} → private.${fn}`));
    expect(offenders).toEqual([]);
  });
});
