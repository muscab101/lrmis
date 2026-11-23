import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// Land drawn with 4 corners (0275) keeps the drawn shape as its boundary; width × length still bills.
let db: PGlite;
let surveyor: string;
let admin: string;
let hodan: string;
let nbhd: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const land = (extra: Record<string, unknown> = {}) => ({
  district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 20, plot_length_m: 30,
  property_type: "storey", land_use: "residential", owner_name: "Cabdi Xasan Nuur", owner_phone: "+252615550177", ...extra,
});
const taxBills = (parcel: string) =>
  db.query<{ total: string; line: string }>(
    `select i.total::text, (select string_agg(l.description, ' | ') from public.invoice_lines l where l.invoice_id = i.id) line
       from public.invoices i join public.fee_types f on f.id = i.fee_type_id
      where i.parcel_id = $1 and f.code = 'property_bill' and i.status <> 'cancelled'`, [parcel]).then((r) => r.rows);

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
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('storey','Dabaq','Storey building', 0.4) on conflict (code) do update set amount = 0.4, active = true`);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('upper','Dabaqyada sare','Upper Floors', 0.2) on conflict (code) do update set amount = 0.2, active = true`);
});

const shape = (dx = 0.0001) => ({
  type: "Polygon",
  coordinates: [[[45.3 - dx, 2.04 - dx], [45.3 + dx, 2.04 - dx], [45.3 + dx, 2.04 + dx], [45.3 - dx, 2.04 + dx], [45.3 - dx, 2.04 - dx]]],
});

describe("4-corner shape kept on new land (0275)", () => {
  it("the drawn shape becomes the boundary, not provisional; the bill still uses width × length", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "21", geom: shape() }))]));
    const p = (await db.query<{ same: boolean; provisional: boolean; area: string }>(
      `select extensions.st_equals(geom, extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326)) same, geom_provisional provisional, area_m2::text area
         from public.parcels where id = $1`, [out.parcel_id, JSON.stringify(shape())])).rows[0]!;
    expect(p).toMatchObject({ same: true, provisional: false, area: "600.00" });
    expect(Number((await taxBills(out.parcel_id))[0]!.total)).toBe(240);
  });

  it("without a shape the land still gets the stand-in square", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "22" }))]));
    expect(await scalar<boolean>(db, `select geom_provisional from public.parcels where id = $1`, [out.parcel_id])).toBe(true);
  });

  it("refuses a shape far from the pin, and saves nothing", async () => {
    const far = { type: "Polygon", coordinates: [[[45.31, 2.05], [45.3102, 2.05], [45.3102, 2.0502], [45.31, 2.0502], [45.31, 2.05]]] };
    const before = await scalar<number>(db, `select count(*)::int from public.parties`);
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "23", geom: far }))])), "VALIDATION");
    expect(await scalar<number>(db, `select count(*)::int from public.parties`)).toBe(before);
  });
});
