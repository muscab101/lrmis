import { readFileSync } from "node:fs";
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
    const special = [...sql.slice(sql.indexOf("-- SPECIAL")).matchAll(/\('([a-z_]+\.[a-z_0-9]+)',/g)].map((m) => m[1]);
    expect(special).toEqual([...SPECIAL_PERMISSIONS]);
  });
  it("total count matches the database test (208)", () => expect(ALL_PERMISSIONS).toHaveLength(208));
});
