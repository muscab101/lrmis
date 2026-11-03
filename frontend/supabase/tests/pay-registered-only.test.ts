import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let part: string;
let reg: string;
let partBill: string;
let regBill: string;
let shift: string;

const bill = async (parcel: string, district: string, n: string) => {
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'service_charge'`);
  return scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ($1, $2, $3, $4, '2026', current_date + 30, 12) returning id`,
    [n, parcel, district, fee],
  );
};
const take = (parcel: string, invoice: string | null) =>
  asUser(db, admin, (tx) => tx.query(`select public.cashier_take_payment($1, $2)`, [shift, { parcel_id: parcel, invoice_id: invoice, amount: 12, currency: "USD", method: "cash" }]));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','Taleex','Taleh') returning id`, [sector]);
  const land = (pun: string, status: string, i: number) =>
    scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
       values ($1, $1, $2, $3, $1, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5::public.parcel_status, case when $5 = 'registered' then now() end) returning id`,
      [pun, hodan, nbhd, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001)), status],
    );
  part = await land("BNPART01", "draft", 1);
  reg = await land("BNREG001", "registered", 2);
  partBill = await bill(part, hodan, "INV-T-1");
  regBill = await bill(reg, hodan, "INV-T-2");
  const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('P1','Desk',$1,'TST') returning id`, [hodan]);
  await createStaff(db, admin, "unused@gmail.com", ["cashier"], [hodan]);
  shift = await scalar<string>(db, `insert into public.cashier_shifts (number, pos_id, cashier_id, district_id, opening_float) values ('SH-T', $1, $2, $3, 0) returning id`, [pos, admin, hodan]);
});

describe("only registered land's bills can be paid", () => {
  it("the cashier is refused on partial land, by parcel or by bill, and nothing is recorded", async () => {
    await expect(take(part, null)).rejects.toThrow(/^CONFLICT: bill_needs_registered/);
    await expect(take(part, partBill)).rejects.toThrow(/^CONFLICT: bill_needs_registered/);
    expect(await scalar<number>(db, `select count(*)::int from public.payments where parcel_id = $1`, [part])).toBe(0);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("issued");
  });

  it("registered land pays as before", async () => {
    await take(reg, regBill);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [regBill])).toBe("paid");
  });

  it("an online payment can't start, and the QR page says why", async () => {
    await expect(asUser(db, admin, (tx) => tx.query(`select public.payment_intent_create($1, null, 'test', '+252615550101')`, [partBill]))).rejects.toThrow(/^CONFLICT: bill_needs_registered/);
    const token = await scalar<string>(db, `select token from public.invoice_tokens where invoice_id = $1`, [partBill]);
    const pub = await as(db, "anon", {}, (tx) => scalar<{ partial: boolean }>(tx, `select public.invoice_by_token($1)`, [token]));
    expect(pub.partial).toBe(true);
  });

  it("money a provider sends for partial land is kept, unmatched, with the bill unpaid; it can't be matched to that land", async () => {
    const { result, payment_id } = await asService(db, (tx) =>
      scalar<{ result: string; payment_id: string }>(tx, `select public.webhook_ingest('test', 'ev1', true, $1, '{}')`, [
        JSON.stringify({ status: "succeeded", reference: "BNPART01", amount: 12, currency: "USD", provider_ref: "ref1" }),
      ]),
    );
    expect(result).toBe("unmatched");
    expect(await scalar<string>(db, `select status from public.payments where id = $1`, [payment_id])).toBe("unmatched");
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("issued");
    await expect(asUser(db, admin, (tx) => tx.query(`select public.payment_match($1, $2)`, [payment_id, part]))).rejects.toThrow(/^CONFLICT: bill_needs_registered/);
  });

  it("the two lists add up separately", async () => {
    const rows = await asUser(db, admin, (tx) => tx.query<{ partial: boolean; invoices: string; owed: string }>(`select * from public.invoices_by_land()`));
    expect(rows.rows.find((r) => r.partial)).toMatchObject({ partial: true });
    expect(Number(rows.rows.find((r) => r.partial)!.owed)).toBe(12);
    expect(Number(rows.rows.find((r) => !r.partial)!.owed)).toBe(0);
  });
});
