import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let cashier2: string;
let officer: string;
let manager: string;
let hodan: string;
let parcels: string[] = [];
let invoices: string[] = [];
let shift: string;
let shift2: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const take = (who: string, sh: string, p: Record<string, unknown>) =>
  asUser(db, who, (tx) => scalar<{ payment_id: string; receipt_no: string }>(tx, `select public.cashier_take_payment($1, $2)`, [sh, JSON.stringify({ currency: "USD", ...p })]));

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
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
  manager = await createStaff(db, admin, "manager@gmail.com", ["finance_manager"], "all");
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  for (let n = 1; n <= 4; n++) {
    const id = await scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
       values ($1, $2, $3, $4, 'residential', 300, extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), 'registered', now()) returning id`,
      [`BN0101${n}`, `HDN000000${n}`, hodan, nbhd, JSON.stringify(square(45.3 + n * 0.0003, 2.04, 0.0001))],
    );
    parcels.push(id);
    invoices.push(
      await scalar<string>(
        db,
        `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
         values (private.invoice_number(2026), $1, $2, $3, '2026', current_date, current_date + 30, 100) returning id`,
        [id, hodan, tax],
      ),
    );
  }
  const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
  shift = await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
  shift2 = await asUser(db, cashier2, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
});

describe("collections, stage 1: wallets, expected amount, duplicates, evidence", () => {
  it("mobile money at the desk needs the wallet and the transaction reference", async () => {
    await expectError(take(cashier, shift, { parcel_id: parcels[0], amount: 40, method: "mobile_money", reference: "EVC1" }), "VALIDATION: wallet");
    await expectError(take(cashier, shift, { parcel_id: parcels[0], amount: 40, method: "mobile_money", wallet: "evc_plus" }), "VALIDATION: reference_required");
    await expectError(take(cashier, shift, { parcel_id: parcels[0], amount: 40, method: "bank_transfer" }), "VALIDATION: reference_required");
    const r = await take(cashier, shift, { parcel_id: parcels[0], amount: 40, method: "mobile_money", wallet: "evc_plus", reference: "evc1001" });
    const row = await scalar<{ wallet: string; provider: string; expected_amount: string; channel: string }>(
      db,
      `select json_build_object('wallet', wallet, 'provider', provider, 'expected_amount', expected_amount, 'channel', private.collection_channel(method, wallet)) from public.payments where id = $1`,
      [r.payment_id],
    );
    expect(row).toMatchObject({ wallet: "evc_plus", provider: "evc_plus", channel: "evc_plus" });
    // What was owed when they paid: the bill's 100, so 40 is an underpayment.
    expect(Number(row.expected_amount)).toBe(100);
  });

  it("a transaction reference is used once per wallet; the same amount moments later needs a confirmation", async () => {
    await expectError(take(cashier2, shift2, { parcel_id: parcels[1], amount: 25, method: "mobile_money", wallet: "evc_plus", reference: "EVC1001" }), "CONFLICT: duplicate_reference");
    // Another wallet may carry the same number.
    await take(cashier2, shift2, { parcel_id: parcels[1], amount: 25, method: "mobile_money", wallet: "zaad", reference: "EVC1001" });
    await take(cashier, shift, { parcel_id: parcels[2], amount: 30, method: "cash" });
    await expectError(take(cashier, shift, { parcel_id: parcels[2], amount: 30, method: "cash" }), "CONFLICT: possible_duplicate");
    await take(cashier, shift, { parcel_id: parcels[2], amount: 30, method: "cash", confirm_duplicate: true });
  });

  it("finance staff list likely duplicates; cashiers can't", async () => {
    const d = await asUser(db, officer, (tx) => tx.query<{ kind: string; key: string }>(`select * from public.payment_duplicates(current_date, current_date)`));
    expect(d.rows.filter((r) => r.kind === "same_reference" && r.key === "EVC1001")).toHaveLength(2);
    expect(d.rows.filter((r) => r.kind === "same_amount")).toHaveLength(2);
    await expectError(asUser(db, cashier, (tx) => tx.query(`select * from public.payment_duplicates(current_date, current_date)`)), "PERMISSION_DENIED");
  });

  it("the cashier who took a payment, or finance staff, keep evidence with it", async () => {
    const pay = await scalar<string>(db, `select id from public.payments where reference = 'evc1001'`);
    await asUser(db, cashier, (tx) => tx.query(`select public.payment_add_evidence($1, $2, 'sms.png', 'image/png', 'SMS from EVC')`, [pay, `${pay}/${crypto.randomUUID()}.png`]));
    await expectError(
      asUser(db, cashier2, (tx) => tx.query(`select public.payment_add_evidence($1, $2, 'x.png', 'image/png')`, [pay, `${pay}/${crypto.randomUUID()}.png`])),
      "PERMISSION_DENIED",
    );
    await asUser(db, officer, (tx) => tx.query(`select public.payment_add_evidence($1, $2, 'statement.pdf', 'application/pdf')`, [pay, `${pay}/${crypto.randomUUID()}.pdf`]));
    const n = await asUser(db, officer, (tx) => scalar<number>(tx, `select count(*)::int from public.payment_evidence where payment_id = $1`, [pay]));
    expect(n).toBe(2);
  });
});
