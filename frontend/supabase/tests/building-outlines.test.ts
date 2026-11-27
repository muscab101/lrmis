import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

// The roof under the pin: its middle and outline (0291).
let db: PGlite;
let admin: string;
let clerk: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  clerk = await createStaff(db, admin, "clerk@gmail.com", ["customer_service"], "all");
  // A 10 m × 10 m roof and an L-shaped one, loaded the way the import script does.
  const d = 0.00009; // about 10 m
  const sq = `POLYGON((45.3 2.04,${45.3 + d} 2.04,${45.3 + d} ${2.04 + d},45.3 ${2.04 + d},45.3 2.04))`;
  const L = `POLYGON((45.31 2.04,${45.31 + 2 * d} 2.04,${45.31 + 2 * d} ${2.04 + d / 4},${45.31 + d / 4} ${2.04 + d / 4},${45.31 + d / 4} ${2.04 + 2 * d},45.31 ${2.04 + 2 * d},45.31 2.04))`;
  const n = await as(db, "service_role", {}, (tx) =>
    scalar<number>(tx, `select public.building_outlines_load($1)`, [JSON.stringify([{ wkt: sq, confidence: 0.9 }, { wkt: L, confidence: 0.8 }, { wkt: "POLYGON((45 2,45.000001 2,45.000001 2.000001,45 2))" }])]),
  );
  expect(n).toBe(2); // the speck under 4 m² is skipped
});

describe("building outlines (0291)", () => {
  it("a pin anywhere on the roof gives its middle and outline", async () => {
    const b = await asUser(db, admin, (tx) => scalar<{ centre: number[]; area_m2: number; outline: { type: string } }>(tx, `select public.building_at(45.30002, 2.04001)`));
    expect(b.outline.type).toBe("Polygon");
    expect(b.centre[0]).toBeCloseTo(45.300045, 5);
    expect(b.centre[1]).toBeCloseTo(2.040045, 5);
    expect(b.area_m2).toBeGreaterThan(90);
  });

  it("measures the roof: width and length in metres (0292)", async () => {
    const b = await asUser(db, admin, (tx) => scalar<{ width_m: number; length_m: number; angle: number }>(tx, `select public.building_at(45.30002, 2.04001)`));
    expect(b.width_m).toBeGreaterThan(9.5);
    expect(b.width_m).toBeLessThan(10.5);
    expect(b.length_m).toBeGreaterThan(9.5);
    expect(b.length_m).toBeLessThan(10.5);
    expect(b.angle % 90).toBe(0);
  });

  it("an L-shaped roof's middle is still on the roof", async () => {
    const b = await asUser(db, admin, (tx) => scalar<{ id: number; centre: number[] }>(tx, `select public.building_at(45.31001, 2.04001)`));
    const inside = await scalar<boolean>(
      db,
      `select extensions.st_contains(geom, extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326)) from private.building_outlines where id = $1`,
      [b.id, b.centre[0], b.centre[1]],
    );
    expect(inside).toBe(true);
  });

  it("nothing far from a roof, and only for staff who may draw land", async () => {
    expect(await asUser(db, admin, (tx) => scalar(tx, `select public.building_at(45.5, 2.2)`))).toBeNull();
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.building_at(45.30002, 2.04001)`))).rejects.toThrow(/^PERMISSION_DENIED/);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.building_outlines_load('[]')`))).rejects.toThrow();
  });
});
