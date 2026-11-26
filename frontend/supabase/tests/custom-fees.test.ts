import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// Fee types you create, charged at chosen moments with a formula (0288).
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

const customFee = (code: string, amount: number, chargeOn: string[], factors: string[]) =>
  asUser(db, admin, (tx) =>
    scalar<string>(tx, `select public.valuation_save_fee_type(null, $1)`, [
      JSON.stringify({ code, name_so: code, name_en: code, interval: "one_off", amount, active: true, charge_on: chargeOn, factors }),
    ]),
  );
const feeBill = (parcel: string, code: string) =>
  db.query<{ total: string; status: string; note: string }>(
    `select i.total::text, i.status, i.note from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 and f.code = $2 and i.status <> 'cancelled'`,
    [parcel, code],
  ).then((r) => r.rows);

describe("fee types with a formula, charged by themselves (0288)", () => {
  it("at registration: 0.05 × area × storeys on 144 m² with 2 storeys = 14.40, billed once", async () => {
    await customFee("garbage", 0.05, ["registration"], ["area", "storeys"]);
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "41", upper_storeys: 2, plot_width_m: 12, plot_length_m: 12 }))]));
    const bills = await feeBill(out.parcel_id, "garbage");
    expect(bills.map((b) => Number(b.total))).toEqual([14.4]);
    // A second tax bill (e.g. billed again) doesn't bill the fee twice.
    await db.query(`select private.charge_custom_fees($1, 'registration', 'auto:registration')`, [out.parcel_id]);
    expect(await feeBill(out.parcel_id, "garbage")).toHaveLength(1);
  });

  it("a missing factor means no bill; a fee not set for this moment isn't billed", async () => {
    await customFee("frontage", 2, ["registration"], ["width", "floors"]);
    await customFee("yearly_only", 5, ["yearly"], []);
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "42" }))]));
    expect(await feeBill(out.parcel_id, "frontage")).toHaveLength(0);
    expect(await feeBill(out.parcel_id, "yearly_only")).toHaveLength(0);
  });

  it("a new size re-bills the unpaid fee bill", async () => {
    await customFee("cleaning", 0.1, ["registration"], ["area"]);
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify(land({ house_no: "43", plot_width_m: 10, plot_length_m: 10 }))]));
    expect(Number((await feeBill(out.parcel_id, "cleaning"))[0]!.total)).toBe(10);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_update_details($1, '{"plot_width_m":"20","plot_length_m":"10"}')`, [out.parcel_id]));
    expect(Number((await feeBill(out.parcel_id, "cleaning"))[0]!.total)).toBe(20);
  });

  it("the system's own fee types never take a moment or formula", async () => {
    const id = await scalar<string>(db, `select id from public.fee_types where code = 'service_charge'`);
    await asUser(db, admin, (tx) =>
      tx.query(`select public.valuation_save_fee_type($1, $2)`, [id, JSON.stringify({ name_so: "Khidmadda adeegga", name_en: "Service charge", interval: "one_off", amount: 12, charge_on: ["yearly"], factors: ["area"] })]),
    );
    expect(await scalar<string[]>(db, `select charge_on from public.fee_types where id = $1`, [id])).toEqual([]);
  });
});
