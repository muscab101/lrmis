import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, ALL_PERMISSIONS, MODULES, SPECIAL_PERMISSIONS } from "../src/permissions";

const sql = readFileSync(
  join(import.meta.dirname, "../../../supabase/migrations/20261015000003_rbac_catalog.sql"),
  "utf8",
);

function arrayAfter(marker: string): string[] {
  const start = sql.indexOf(marker);
  const block = sql.slice(start, sql.indexOf("])", start));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("permission catalog stays in sync with the SQL migration", () => {
  it("modules", () => expect(arrayAfter("-- MODULES")).toEqual([...MODULES]));
  it("actions", () => expect(arrayAfter("-- ACTIONS")).toEqual([...ACTIONS]));
  it("special permissions", () => {
    const special = [...sql.slice(sql.indexOf("-- SPECIAL")).matchAll(/\('([a-z_]+\.[a-z_0-9]+)',/g)].map((m) => m[1]!);
    // Later migrations may add special permissions with `insert into public.permissions`.
    const dir = join(import.meta.dirname, "../../../supabase/migrations");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql") && n > "20261015000003")) {
      const later = readFileSync(join(dir, f), "utf8");
      // Every row of each insert, as one insert can add several.
      for (const block of later.matchAll(/insert into public\.permissions[^;]*?values([^;]*);/g)) {
        for (const m of block[1]!.matchAll(/\('([a-z_]+\.[a-z_0-9]+)',/g)) if (!special.includes(m[1]!)) special.push(m[1]!);
      }
    }
    expect(special.sort()).toEqual([...SPECIAL_PERMISSIONS].sort());
  });
  it("total count matches the database test (224)", () => expect(ALL_PERMISSIONS).toHaveLength(224));
});
