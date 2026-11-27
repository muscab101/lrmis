import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square, completeLand } from "./harness";

let db: PGlite;
let admin: string;
let part: string;
let lonely: string;
let reg: string;
let partBill: string;
let lonelyBill: string;
let regBill: string;
let owner: string;
let shift: string;

const bill = async (parcel: string, district: string, n: string) => {
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'service_charge'`);
  return scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ($1, $2, $3, $4, '2026', current_date + 30, 12) returning id`,
    [n, parcel, district, fee],
  );
};
const take = (parcel: string, invoice: string | null, amount = 12) =>
  asUser(db, admin, (tx) => tx.query(`select public.cashier_take_payment($1, $2)`, [shift, { parcel_id: parcel, invoice_id: invoice, amount, currency: "USD", method: "cash" }]));
const land = (id: string) => scalar<{ status: string; pun: string | null }>(db, `select jsonb_build_object('status', status, 'pun', pun) from public.parcels where id = $1`, [id]);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','Taleex','Taleh') returning id`, [sector]);
  const make = (house: string, status: string, i: number, pun: string | null) =>
    scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
       values ($1, $1, $2, $3, $6, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5::public.parcel_status, case when $5 = 'registered' then now() end) returning id`,
      [pun, hodan, nbhd, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001)), status, house],
    );
  part = await make("11", "draft", 1, null);
  lonely = await make("12", "draft", 3, null);
  reg = await make("13", "registered", 2, "BNREG001");
  owner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Partial Owner', '+252611111199', $1) returning id`, [hodan]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [part, owner]);
  partBill = await bill(part, hodan, "INV-T-1");
  lonelyBill = await bill(lonely, hodan, "INV-T-3");
  regBill = await bill(reg, hodan, "INV-T-2");
  const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('P1','Desk',$1,'TST') returning id`, [hodan]);
  await createStaff(db, admin, "unused@gmail.com", ["cashier"], [hodan]);
  shift = await scalar<string>(db, `insert into public.cashier_shifts (number, pos_id, cashier_id, district_id, opening_float) values ('SH-T', $1, $2, $3, 0) returning id`, [pos, admin, hodan]);
});

describe("partial land pays, and registers by itself once its bills are paid", () => {
  it("part of the bill paid: the land stays partial", async () => {
    await take(part, partBill, 5);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("partially_paid");
    expect((await land(part)).status).toBe("draft");
  });

  it("paid in full: the land is registered with a PUN, and its owner with it", async () => {
    await completeLand(db);
    await take(part, partBill, 7);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("paid");
    const l = await land(part);
    expect(l.status).toBe("registered");
    expect(l.pun).toBeTruthy();
    expect(await scalar<string | null>(db, `select registered_at::text from public.parties where id = $1`, [owner])).not.toBeNull();
  });

  it("land that can't be registered (no owner) keeps the payment and stays partial, with the reason kept", async () => {
    await take(lonely, lonelyBill);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [lonelyBill])).toBe("paid");
    expect((await land(lonely)).status).toBe("draft");
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_history where parcel_id = $1 and action = 'auto_register_failed'`, [lonely])).toBe(1);
  });

  it("registered land pays as before", async () => {
    await take(reg, regBill);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [regBill])).toBe("paid");
  });
});
