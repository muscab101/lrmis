import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// A storey building with one owner (0272): width × length = area, plus how many upper storeys. One invoice:
// area × the building's price + upper storeys × area × the Upper Floors price.
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

describe("upper storeys (0272)", () => {
  it("one invoice: 600 m² × 0.40 base + 2 upper storeys × 600 m² × 0.20", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "5", upper_storeys: 2 }))]));
    expect(await scalar<number>(db, `select upper_storeys from public.parcels where id = $1`, [out.parcel_id])).toBe(2);
    const bills = await taxBills(out.parcel_id);
    expect(bills).toHaveLength(1);
    expect(Number(bills[0]!.total)).toBe(240 + 240);
    expect(bills[0]!.line).toContain("2 upper storeys × 600 m² × 0.20 USD per m² (Upper Floors)");
    const expected = await scalar<{ amount: number; upper_storeys: number }>(db, `select private.parcel_bill_expected($1)`, [out.parcel_id]);
    expect(Number(expected.amount)).toBe(480);
    expect(expected.upper_storeys).toBe(2);
  });

  it("no upper storeys: the bill is the base only; a bad number is refused", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "6" }))]));
    expect(Number((await taxBills(out.parcel_id))[0]!.total)).toBe(240);
    await expectError(
      asUser(db, surveyor, (tx) => tx.query(`select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "9", upper_storeys: 101 }))])),
      "VALIDATION: upper_storeys",
    );
  });

  it("changing the storeys and re-billing updates the same invoice", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "7", upper_storeys: 1 }))]));
    expect(Number((await taxBills(out.parcel_id))[0]!.total)).toBe(360);
    await db.query(`update public.parcels set upper_storeys = 3 where id = $1`, [out.parcel_id]);
    await db.query(`select private.parcel_rebill($1)`, [out.parcel_id]);
    const bills = await taxBills(out.parcel_id);
    expect(bills).toHaveLength(1);
    expect(Number(bills[0]!.total)).toBe(240 + 360);
  });

  it("the edit box: partial land is billed again; registered land gets a line on this year's open invoice", async () => {
    const partial = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "11" }))]));
    expect(Number((await taxBills(partial.parcel_id))[0]!.total)).toBe(240);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_set_upper_storeys($1, 2)`, [partial.parcel_id]));
    expect(Number((await taxBills(partial.parcel_id))[0]!.total)).toBe(480);

    // Registered land (like the old LRMIS buildings): its open bill of this year gets the difference.
    const reg = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "12" }))]));
    await db.query(`update public.parcels set status = 'registered', registered_at = now() where id = $1`, [reg.parcel_id]);
    const out = await asUser(db, admin, (tx) => scalar<{ changed: boolean; difference: number }>(tx, `select public.parcel_set_upper_storeys($1, 3)`, [reg.parcel_id]));
    expect(out.changed).toBe(true);
    expect(Number(out.difference)).toBe(360);
    const bills = await taxBills(reg.parcel_id);
    expect(Number(bills[0]!.total)).toBe(600);
    expect(bills[0]!.line).toContain("Upper storeys changed from 0 to 3");
    // Back to 1: the line takes the difference off again.
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_set_upper_storeys($1, 1)`, [reg.parcel_id]));
    expect(Number((await taxBills(reg.parcel_id))[0]!.total)).toBe(360);
    // Same number again: nothing changes.
    expect((await asUser(db, admin, (tx) => scalar<{ changed: boolean }>(tx, `select public.parcel_set_upper_storeys($1, 1)`, [reg.parcel_id]))).changed).toBe(false);
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.parcel_set_upper_storeys($1, -1)`, [reg.parcel_id])), "VALIDATION: upper_storeys");
  });
});
