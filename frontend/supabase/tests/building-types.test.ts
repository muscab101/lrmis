import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

// Valuation → Building types: the land form's "Building type" list (0271).
let db: PGlite;
let admin: string;
let surveyor: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [district]);
});

describe("building types (0271)", () => {
  it("starts with the house types as one house and the apartment types as flats", async () => {
    const rows = await db.query<{ layout: string; grade_code: string }>(`select layout, grade_code from public.building_types`).then((r) => r.rows);
    const flats = rows.filter((r) => r.layout === "flats").map((r) => r.grade_code);
    expect(flats).toContain("apartment");
    expect(rows.some((r) => r.layout === "house")).toBe(true);
    expect(rows.some((r) => r.grade_code === "upper")).toBe(false);
  });

  it("Valuation staff add, change and delete a type; others only read it", async () => {
    const grade = await scalar<string>(db, `select code from public.property_grades where active order by code limit 1`);
    const id = await asUser(db, admin, (tx) =>
      scalar<string>(tx, `select public.building_type_save(null, $1)`, [JSON.stringify({ name_so: "Guri labo dabaq", name_en: "Two-storey house", layout: "house", grade_code: grade })]),
    );
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.building_type_save(null, $1)`, [JSON.stringify({ name_so: "Kale", name_en: "two-storey house", layout: "house", grade_code: grade })])),
      "CONFLICT: building_type_taken",
    );
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.building_type_save(null, $1)`, [JSON.stringify({ name_so: "Wax", name_en: "Something", layout: "tower", grade_code: grade })])),
      "VALIDATION: building_layout",
    );
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.building_type_save(null, $1)`, [JSON.stringify({ name_so: "Wax", name_en: "Something", layout: "house", grade_code: "nope" })])),
      "VALIDATION: building_grade",
    );
    await asUser(db, admin, (tx) => tx.query(`select public.building_type_save($1, $2)`, [id, JSON.stringify({ name_so: "Guri labo dabaq", name_en: "Two-storey house", layout: "compound", grade_code: grade, active: false })]));
    expect(await scalar<string>(db, `select layout || ':' || active from public.building_types where id = $1`, [id])).toBe("compound:false");
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.building_type_delete($1)`, [id])), "PERMISSION_DENIED");
    expect(await asUser(db, surveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.building_types where id = $1`, [id]))).toBe(1);
    await asUser(db, admin, (tx) => tx.query(`select public.building_type_delete($1)`, [id]));
    expect(await scalar<number>(db, `select count(*)::int from public.building_types where id = $1`, [id])).toBe(0);
  });
});
