import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let hodan: string;
let nbhd: string;
let land: string;
let serviceFee: string;
let taxFee: string;

type Copy = { id: string; number: string; keep: boolean; has_money: boolean; parcel_id: string };
type Missing = { parcel_id: string; code: string; amount: number };
const duplicates = () => asUser(db, admin, (tx) => scalar<Copy[]>(tx, `select public.invoice_duplicates()`));
const missing = () => asUser(db, admin, (tx) => scalar<Missing[]>(tx, `select public.invoice_missing()`));
let n = 0;
// New copies are refused on the way in, so old ones are made the way they used to appear: issued in another year, then moved.
const bill = async (parcel: string, fee: string, total = 12) => {
  const id = await scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total, issue_date) values ($1, $2, $3, $4, $5, current_date + 30, $6, make_date(1900 + $7::int, 1, 1)) returning id`,
    [`T-${++n}`, parcel, hodan, fee, `P-${n}`, total, n],
  );
  await db.query(`update public.invoices set issue_date = current_date where id = $1`, [id]);
  return id;
};
const newLand = (no: number, extra = "") =>
  scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, property_type, plot_width_m, plot_length_m, area_m2, geom, status, registered_at ${extra ? ", building_state" : ""})
     values ($1, $1, $2, $3, $4, 'tool_grade', 10, 10, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), 'registered', now() ${extra ? ", 'demolished'" : ""}) returning id`,
    [`BNTOOL${no}`, hodan, nbhd, String(no), JSON.stringify(square(45.3 + no * 0.0003, 2.04, 0.0001))],
  );

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','Taleex','Taleh') returning id`, [sector]);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('tool_grade','Darajo','Grade', 0.5)`);
  await db.query(`update public.fee_types set active = true, amount = 12 where code = 'service_charge'`);
  serviceFee = await scalar<string>(db, `select id from public.fee_types where code = 'service_charge'`);
  taxFee = await scalar<string>(db, `select id from public.fee_types where code = 'property_bill'`);
  land = await newLand(1);
});

describe("missing bills", () => {
  it("lists what a parcel should be billed, and raises it once", async () => {
    const list = (await missing()).filter((m) => m.parcel_id === land);
    expect(list.map((m) => [m.code, Number(m.amount)]).sort()).toEqual([["property_bill", 50], ["service_charge", 12]]);
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.invoice_missing_create($1)`, [[land]]))).toBe(2);
    expect((await missing()).some((m) => m.parcel_id === land)).toBe(false);
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.invoice_missing_create($1)`, [[land]]))).toBe(0);
  });

  it("a bill that was cancelled is missing again, and a new one replaces it", async () => {
    const tax = await scalar<string>(db, `select i.id from public.invoices i where i.parcel_id = $1 and i.fee_type_id = $2`, [land, taxFee]);
    await db.query(`update public.invoices set status = 'cancelled', cancel_reason = 'Original deleted' where id = $1`, [tax]);
    expect((await missing()).filter((m) => m.parcel_id === land).map((m) => m.code)).toEqual(["property_bill"]);
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.invoice_missing_create($1)`, [[land]]))).toBe(1);
    expect(await scalar<number>(db, `select count(*)::int from public.invoices where parcel_id = $1 and fee_type_id = $2 and status <> 'cancelled'`, [land, taxFee])).toBe(1);
  });

  it("leaves demolished land alone", async () => {
    const gone = await newLand(2, "demolished");
    expect((await missing()).some((m) => m.parcel_id === gone)).toBe(false);
  });
});

describe("duplicate bills", () => {
  it("finds copies, keeps the oldest and cancels the others, on the books too", async () => {
    const copy = await bill(land, serviceFee);
    const found = (await duplicates()).filter((c) => c.parcel_id === land);
    expect(found).toHaveLength(2);
    expect(found.find((c) => c.id === copy)?.keep).toBe(false);
    const res = await asUser(db, admin, (tx) => scalar<{ cancelled: number; left: number }>(tx, `select public.invoice_duplicates_fix()`));
    expect(res).toEqual({ cancelled: 1, left: 0 });
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [copy])).toBe("cancelled");
    expect(await scalar<string>(db, `select cancel_reason from public.invoices where id = $1`, [copy])).toBe("Duplicate bill removed");
    expect(await duplicates()).toEqual([]);
  });

  it("keeps the copy with money on it, and never cancels money", async () => {
    const paidCopy = await bill(land, serviceFee);
    await db.query(`select private.invoice_apply_payment($1, 5)`, [paidCopy]);
    const found = await duplicates();
    expect(found.find((c) => c.keep)?.id).toBe(paidCopy);
    await asUser(db, admin, (tx) => tx.query(`select public.invoice_duplicates_fix()`));
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [paidCopy])).toBe("partially_paid");
    const other = await bill(land, serviceFee);
    await db.query(`select private.invoice_apply_payment($1, 5)`, [other]);
    const res = await asUser(db, admin, (tx) => scalar<{ cancelled: number; left: number }>(tx, `select public.invoice_duplicates_fix()`));
    expect(res).toEqual({ cancelled: 0, left: 1 });
  });

  it("refuses a new copy, but a cancelled one can be made again", async () => {
    const fresh = await newLand(77);
    const insert = (status = "issued") =>
      db.query(
        `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total, status) values ($1, $2, $3, $4, $5, current_date + 30, 12, $6::public.invoice_status)`,
        [`G-${++n}`, fresh, hodan, serviceFee, `P-${n}`, status],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/^CONFLICT: duplicate_bill/);
    await db.query(`update public.invoices set status = 'cancelled' where parcel_id = $1`, [fresh]);
    await insert();
  });

  it("changes one bill's amount with a reason, never below what was paid", async () => {
    const one = await bill(await newLand(78), serviceFee, 20);
    await db.query(`select private.invoice_apply_payment($1, 5)`, [one]);
    const set = (total: number, reason = "Wrong size on the bill") =>
      asUser(db, admin, (tx) => scalar<{ total: number; balance: number }>(tx, `select public.invoice_set_total($1, $2, $3)`, [one, total, reason]));
    await expect(set(4)).rejects.toThrow(/^CONFLICT: rebill_below_paid/);
    await expect(set(10, "no")).rejects.toThrow(/^VALIDATION: reason/);
    expect(await set(10)).toMatchObject({ total: 10, balance: 5 });
    expect(await scalar<number>(db, `select count(*)::int from public.invoice_lines where invoice_id = $1 and amount = -10`, [one])).toBe(1);
    await expect(
      asUser(db, cashier, (tx) => tx.query(`select public.invoice_set_total($1, 12, 'cashier try')`, [one])),
    ).rejects.toThrow(/^PERMISSION_DENIED/);
  });

  it("needs the right permission", async () => {
    await expect(asUser(db, cashier, (tx) => tx.query(`select public.invoice_duplicates_fix()`))).rejects.toThrow(/^PERMISSION_DENIED/);
    await expect(asUser(db, cashier, (tx) => tx.query(`select public.invoice_missing_create($1)`, [[land]]))).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});

describe("neighbourhood prices per house type (0208)", () => {
  it("land in the neighbourhood is billed at its own price; clearing it goes back to the normal price", async () => {
    const grade = await scalar<string>(db, `select id from public.property_grades where code = 'tool_grade'`);
    const save = (amount: number | "") =>
      asUser(db, admin, (tx) => scalar<number>(tx, `select public.neighbourhood_grade_prices_save($1, $2)`, [nbhd, JSON.stringify([{ grade_id: grade, amount }])]));
    expect(await save(0.8)).toBe(1);
    const here = await newLand(90);
    const price = async () => (await missing()).find((m) => m.parcel_id === here && m.code === "property_bill")?.amount;
    expect(Number(await price())).toBe(80);
    expect(Number(await scalar<string>(db, `select private.compute_assessment($1, 2026) ->> 'rate_m2'`, [here]))).toBe(0.8);
    expect(await save("")).toBe(0);
    expect(Number(await price())).toBe(50);
    await expect(
      asUser(db, cashier, (tx) => tx.query(`select public.neighbourhood_grade_prices_save($1, $2)`, [nbhd, JSON.stringify([{ grade_id: grade, amount: 1 }])])),
    ).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});

describe("unpaid bills follow a neighbourhood price change (0218)", () => {
  it("open bills are set to the new price; never below what was paid", async () => {
    const grade = await scalar<string>(db, `select id from public.property_grades where code = 'tool_grade'`);
    const here = await newLand(91);
    await asUser(db, admin, (tx) => tx.query(`select public.invoice_missing_create($1)`, [[here]]));
    const bill = await scalar<string>(db, `select i.id from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 and f.code = 'property_bill'`, [here]);
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [bill]))).toBe(50);
    const price = (amount: number) =>
      asUser(db, admin, (tx) => tx.query(`select public.neighbourhood_grade_prices_save($1, $2)`, [nbhd, JSON.stringify([{ grade_id: grade, amount }])]));
    const rebill = () => asUser(db, admin, (tx) => scalar<{ changed: number; paid_more: number }>(tx, `select public.neighbourhood_rebill($1, $2)`, [nbhd, [grade]]));
    await price(0.8);
    expect((await rebill()).changed).toBeGreaterThanOrEqual(1);
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [bill]))).toBe(80);
    await db.query(`select private.invoice_apply_payment($1, 60)`, [bill]);
    await price(0.5);
    expect((await rebill()).paid_more).toBeGreaterThanOrEqual(1);
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [bill]))).toBe(80);
    await expect(asUser(db, cashier, (tx) => tx.query(`select public.neighbourhood_rebill($1, $2)`, [nbhd, [grade]]))).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});

