import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let surveyor: string;
let hodan: string;
let nbhd: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
});

describe("property types (admin list)", () => {
  it("starts with the ten types; everyone can read them", async () => {
    const n = await asUser(db, surveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.property_types`));
    expect(n).toBe(10);
  });

  it("only admins add and edit; the code comes from the English name", async () => {
    const p = JSON.stringify({ name_so: "Guri laba dabaq", name_en: "Two-storey house", price: 1500 });
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.property_type_save(null, $1)`, [p])), "PERMISSION_DENIED");
    const id = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_save(null, $1)`, [p]));
    const t = await scalar<{ code: string; price: string }>(db, `select to_jsonb(t) from public.property_types t where id = $1`, [id]);
    expect(t.code).toBe("two_storey_house");
    expect(Number(t.price)).toBe(1500);
    await asUser(db, admin, (tx) => tx.query(`select public.property_type_save($1, $2)`, [id, JSON.stringify({ name_so: "Guri laba dabaq", name_en: "Two-storey house", price: 1800 })]));
    expect(Number(await scalar<string>(db, `select price from public.property_types where id = $1`, [id]))).toBe(1800);
  });

  it("staff pick an admin type for new land; a hidden type can't be picked", async () => {
    const app = await asUser(db, surveyor, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd })]));
    await asUser(db, surveyor, (tx) => tx.query(`select public.application_set_details($1, '', '', 'two_storey_house', 'residential')`, [app.id]));
    expect(await scalar<string>(db, `select property_type from public.applications where id = $1`, [app.id])).toBe("two_storey_house");
    // In use → hidden, not deleted.
    const id = await scalar<string>(db, `select id from public.property_types where code = 'two_storey_house'`);
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_delete($1)`, [id]))).toBe("hidden");
    const app2 = await asUser(db, surveyor, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd })]));
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.application_set_details($1, '', '', 'two_storey_house', null)`, [app2.id])), "VALIDATION: property_type_inactive");
    // An unused type is really deleted.
    const unused = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_save(null, '{"name_so":"Tijaabo","name_en":"Trial type"}')`));
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_delete($1)`, [unused]))).toBe("deleted");
  });
});
