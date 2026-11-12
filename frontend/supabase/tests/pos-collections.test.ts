import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let cashier: string;
let cashier2: string;
let officer: string;
let admin: string;
let pos: string;
const today = new Date().toISOString().slice(0, 10);

type Pos = { code: string; total: number; approved: number; waiting: number; cashiers: { cashier_id: string; total: number; waiting: number; waiting_count: number }[] };

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  cashier2 = await createStaff(db, admin, "cashier2@gmail.com", ["cashier"], [hodan]);
  officer = await createStaff(db, admin, "auditor@gmail.com", ["auditor"], [hodan]);
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
  await db.query(`insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN2', 'Hodan market', $1, 'HDN2')`, [hodan]);
  const shift = await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
  const shift2 = await asUser(db, cashier2, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
  for (let n = 1; n <= 3; n++) {
    const parcel = await scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
       values ($1, $2, $3, $4, 'residential', 300, extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), 'registered', now()) returning id`,
      [`BN0101${n}`, `HDN000000${n}`, hodan, nbhd, JSON.stringify(square(45.3 + n * 0.0003, 2.04, 0.0001))],
    );
    await db.query(
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
       values (private.invoice_number(2026), $1, $2, $3, '2026', current_date, current_date + 30, 100)`,
      [parcel, hodan, tax],
    );
    // Cashier 1 takes two payments, cashier 2 one.
    const [who, sh] = n < 3 ? [cashier, shift] : [cashier2, shift2];
    await asUser(db, who, (tx) => tx.query(`select public.cashier_take_payment($1, $2)`, [sh, JSON.stringify({ currency: "USD", parcel_id: parcel, amount: 30, method: "cash" })]));
  }
});

describe("collections by point of sale", () => {
  it("shows the point of sale's money and each cashier's share; a chosen point of sale shows even with none yet", async () => {
    const list = await asUser(db, officer, (tx) => scalar<Pos[]>(tx, `select public.collections_by_pos($1, $2)`, [today, today]));
    expect(list.map((p) => p.code)).toEqual(["HDN1"]);
    expect(Number(list[0]!.total)).toBe(90);
    expect(Number(list[0]!.waiting)).toBe(90);
    const one = list[0]!.cashiers.find((c) => c.cashier_id === cashier)!;
    expect(Number(one.total)).toBe(60);
    expect(one.waiting_count).toBe(2);
    // By way of paying, for the office and the cashier.
    expect(Number((list[0] as unknown as { channels: Record<string, number> }).channels.cash)).toBe(90);
    expect(Number((one as unknown as { channels: Record<string, number> }).channels.cash)).toBe(60);
    // The payments behind the row (its eye icon), for finance staff only.
    const rows = await asUser(db, officer, async (tx) =>
      (await tx.query<{ receipt_no: string; channel: string; amount: string; pun: string; owners: string | null }>(`select * from public.pos_cashier_payments($1, $2, $3, $3)`, [pos, cashier, today])).rows,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => "owners" in r)).toBe(true);
    expect(rows.every((r) => r.channel === "cash" && Number(r.amount) === 30 && r.pun)).toBe(true);
    // By bill type: what the money paid for, for the office and for each payment.
    const types = (list[0] as unknown as { bill_types: { code: string; total: number }[] }).bill_types;
    expect(types.map((b) => [b.code, Number(b.total)])).toEqual([["property_tax", 90]]);
    expect(Number((one as unknown as { bill_types: Record<string, number> }).bill_types.property_tax)).toBe(60);
    const bills = (rows[0] as unknown as { bills: { code: string; number: string; amount: number }[] }).bills;
    expect(bills.map((b) => [b.code, Number(b.amount)])).toEqual([["property_tax", 30]]);
    await expectError(asUser(db, cashier, (tx) => tx.query(`select * from public.pos_cashier_payments($1, $2, $3, $3)`, [pos, cashier, today])), "PERMISSION_DENIED");
    // Choosing a point of sale shows it even with no money yet; the list offers every point of sale in your districts.
    const choices = await asUser(db, officer, async (tx) => (await tx.query<{ id: string; code: string }>(`select id, code from public.collections_pos_choices()`)).rows);
    expect(choices.map((c) => c.code).sort()).toEqual(["HDN1", "HDN2", "ONLINE"]);
    const market = choices.find((c) => c.code === "HDN2")!.id;
    const found = await asUser(db, officer, (tx) => scalar<Pos[]>(tx, `select public.collections_by_pos($1, $2, $3)`, [today, today, market]));
    expect(found.map((p) => p.code)).toEqual(["HDN2"]);
    expect(Number(found[0]!.total)).toBe(0);
  });

  it("approves one cashier's waiting payments in one go, never your own, and not twice", async () => {
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.pos_cashier_approve($1, $2, $3, $3)`, [pos, cashier, today])), "PERMISSION_DENIED");
    const n = await asUser(db, officer, (tx) => scalar<number>(tx, `select public.pos_cashier_approve($1, $2, $3, $3)`, [pos, cashier, today]));
    expect(n).toBe(2);
    const after = await asUser(db, officer, (tx) => scalar<Pos[]>(tx, `select public.collections_by_pos($1, $2)`, [today, today]));
    expect(Number(after[0]!.approved)).toBe(60);
    expect(Number(after[0]!.waiting)).toBe(30);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.pos_cashier_approve($1, $2, $3, $3)`, [pos, cashier, today])), "CONFLICT: nothing_to_approve");
  });
  it("a district office also shows that district's online payments, approved on their own", async () => {
    const online = await scalar<string>(db, `select id from public.points_of_sale where district_id is null limit 1`);
    const hodan = await scalar<string>(db, `select id from public.districts where code = 'HDN'`);
    const parcel = await scalar<string>(db, `select id from public.parcels where pun = 'BN01011'`);
    // An online payment for Hodan land, recorded by cashier 2 (e.g. a mobile money payment they entered online).
    await db.query(
      `insert into public.payments (receipt_no, parcel_id, district_id, method, currency, amount, amount_base, pos_id, created_by)
       values ('ONL-TEST-1', $1, $2, 'mobile_money', 'USD', 25, 25, $3, $4)`,
      [parcel, hodan, online, cashier2],
    );
    const office = await asUser(db, officer, (tx) => scalar<(Pos & { cashiers: { online: boolean; pos_id: string }[] })[]>(tx, `select public.collections_by_pos($1, $2, $3)`, [today, today, pos]));
    const row = office[0]!.cashiers.find((c) => c.online)!;
    expect(Number(row.total)).toBe(25);
    expect(row.pos_id).toBe(online);
    expect(Number(office[0]!.total)).toBe(115);
    // The district's second office doesn't count them again.
    const market = await scalar<string>(db, `select id from public.points_of_sale where code = 'HDN2'`);
    const other = await asUser(db, officer, (tx) => scalar<Pos[]>(tx, `select public.collections_by_pos($1, $2, $3)`, [today, today, market]));
    expect(Number(other[0]!.total)).toBe(0);
    // Approving the online row approves only Hodan's online payments, not cashier 2's desk payment.
    const n = await asUser(db, officer, (tx) => scalar<number>(tx, `select public.pos_cashier_approve($1, $2, $3, $3, $4)`, [online, cashier2, today, hodan]));
    expect(n).toBe(1);
    expect(await scalar<string>(db, `select verify_status from public.payments where receipt_no = 'ONL-TEST-1'`)).toBe("verified");
    const desk = await scalar<number>(db, `select count(*)::int from public.payments where created_by = $1 and pos_id = $2 and verify_status = 'pending'`, [cashier2, pos]);
    expect(desk).toBe(1);
  });

  it("the Super Admin may approve payments they took themselves; nobody else may", async () => {
    const hodan = await scalar<string>(db, `select id from public.districts where code = 'HDN'`);
    const parcel = await scalar<string>(db, `select id from public.parcels where pun = 'BN01012'`);
    const own = await scalar<string>(
      db,
      `insert into public.payments (receipt_no, parcel_id, district_id, method, currency, amount, amount_base, pos_id, created_by)
       values ('HDN1-OWN-1', $1, $2, 'cash', 'USD', 5, 5, $3, $4) returning id`,
      [parcel, hodan, pos, admin],
    );
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.payment_verify($1)`, [[own]]))).toBe(1);
    // A finance officer still can't approve their own.
    const theirs = await scalar<string>(
      db,
      `insert into public.payments (receipt_no, parcel_id, district_id, method, currency, amount, amount_base, pos_id, created_by)
       values ('HDN1-OWN-2', $1, $2, 'cash', 'USD', 5, 5, $3, $4) returning id`,
      [parcel, hodan, pos, officer],
    );
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.payment_verify($1)`, [[theirs]])), "MAKER_CHECKER");
  });
});

describe("push payment only after a problem (0212)", () => {
  it("a bill can be pushed only once its money went wrong", async () => {
    const inv = await scalar<string>(db, `select id from public.invoices where balance > 0 order by number limit 1`);
    const allowed = () => asUser(db, cashier, (tx) => scalar<string[]>(tx, `select public.invoices_push_allowed($1)`, [[inv]]));
    expect(await allowed()).toEqual([]);
    await db.query(
      `insert into public.payment_intents (invoice_id, provider, amount, currency, status, expires_at) select id, 'test', balance, 'USD', 'failed', now() from public.invoices where id = $1`,
      [inv],
    );
    expect(await allowed()).toEqual([inv]);
  });
});

