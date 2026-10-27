import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let valuer: string;
let biller: string;
let finance: string;
let finance2: string;
let cashier: string;
let accountant: string;
let citizen: string;
let hodan: string;
let nbhd: string;
let parcelA: string; // owned by the citizen, invoice 210 (discount window open)
let parcelB: string; // invoice 510
let invA: string;
let invB: string;
let pos: string;
let shift: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const invoice = (id: string) =>
  scalar<{ total: string; paid: string; credited: string; balance: string; status: string }>(db, `select row_to_json(i) from public.invoices i where id = $1`, [id]);

/** Debits must equal credits across the whole ledger, and per account for receivables must match open invoices. */
async function ledger() {
  const r = await scalar<{ dr: string; cr: string; debtors: string; open: string; credit: string }>(
    db,
    `select json_build_object(
       'dr', (select coalesce(sum(debit), 0) from public.journal_lines),
       'cr', (select coalesce(sum(credit), 0) from public.journal_lines),
       'debtors', (select coalesce(sum(debit - credit), 0) from public.journal_lines where account = '1200'),
       'open', (select coalesce(sum(balance), 0) from public.invoices where status <> 'cancelled'),
       'credit', (select coalesce(sum(credit - debit), 0) from public.journal_lines where account = '2100'))`,
  );
  return { dr: Number(r.dr), cr: Number(r.cr), debtors: Number(r.debtors), open: Number(r.open), credit: Number(r.credit) };
}

async function registeredParcel(n: number, area: number, ownerUser?: string) {
  const id = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, developed, area_m2, geom, status, registered_at)
     values ($1, $2, $3, $4, 'residential', false, $5, extensions.st_setsrid(extensions.st_geomfromgeojson($6), 4326), 'registered', now()) returning id`,
    [`BN-HDN-012-00000${n}`, `HDN000000${n}`, hodan, nbhd, area, JSON.stringify(square(45.3 + n * 0.0003, 2.04, 0.0001))],
  );
  if (ownerUser) {
    const party = await scalar<string>(db, `insert into public.parties (full_name, phone, citizen_user_id) values ('Owner', '+252615550101', $1) returning id`, [ownerUser]);
    await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [id, party]);
  }
  return id;
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
  valuer = await createStaff(db, admin, "valuer@gmail.com", ["valuation_officer"], [hodan]);
  biller = await createStaff(db, admin, "biller@gmail.com", ["billing_officer"], [hodan]);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  finance2 = await createStaff(db, admin, "finance2@gmail.com", ["finance_manager"], "all");
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  accountant = await createStaff(db, admin, "accountant@gmail.com", ["accountant"], "all");
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Owner" });
  const propertyTax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);

  parcelA = await registeredParcel(1, 400, citizen);
  parcelB = await registeredParcel(2, 1000);
  await asUser(db, valuer, async (tx) => {
    await tx.query(`select public.valuation_set_rate($1, 'residential', false, 0.5, 10, '2026-01-01')`, [nbhd]);
    await tx.query(`select public.assess_parcel($1, 2026)`, [parcelA]);
    await tx.query(`select public.assess_parcel($1, 2026)`, [parcelB]);
  });
  const run = await asUser(db, biller, (tx) =>
    scalar<{ id: string }>(tx, `select public.billing_run_create($1)`, [JSON.stringify({ year: 2026, fee_type_id: propertyTax, district_ids: [hodan], due_date: "2026-12-31" })]),
  );
  await asUser(db, biller, (tx) => tx.query(`select public.billing_run_submit($1)`, [run.id]));
  await asUser(db, finance, async (tx) => {
    await tx.query(`select public.billing_run_approve($1)`, [run.id]);
    await tx.query(`select public.billing_run_generate($1)`, [run.id]);
  });
  invA = await scalar<string>(db, `select id from public.invoices where parcel_id = $1`, [parcelA]);
  invB = await scalar<string>(db, `select id from public.invoices where parcel_id = $1`, [parcelB]);
  pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
});

describe("payments and accounting (Phase 7)", () => {
  it("issuing invoices posts balanced journals: debtors equal open invoices", async () => {
    const l = await ledger();
    expect(l.dr).toBe(l.cr);
    expect(l.debtors).toBe(720);
    expect(l.open).toBe(720);
  });

  it("cashiers take payments only inside their own open shift", async () => {
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.cashier_take_payment(gen_random_uuid(), '{}')`)), "CONFLICT: shift_not_open");
    shift = await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 20)`, [pos]));
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.shift_open($1, 0)`, [pos])), "CONFLICT: shift_open");
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: parcelB, amount: 10 })])), "PERMISSION_DENIED");
  });

  it("partial cash payment: oldest invoice first, receipt numbered per point of sale, journal Dr cash / Cr debtors", async () => {
    const out = await asUser(db, cashier, (tx) =>
      scalar<{ receipt_no: string; allocated: number; leftover: number }>(tx, `select public.cashier_take_payment($1, $2)`, [
        shift,
        JSON.stringify({ parcel_id: parcelB, amount: 100, currency: "USD", method: "cash", payer_name: "Xasan" }),
      ]),
    );
    expect(out.receipt_no).toBe("HDN1-2026-000001");
    expect(Number(out.allocated)).toBe(100);
    const b = await invoice(invB);
    expect(b.status).toBe("partially_paid");
    expect(Number(b.balance)).toBe(410);
    const l = await ledger();
    expect(l.dr).toBe(l.cr);
    expect(l.debtors).toBe(l.open);
    expect(Number(await scalar<string>(db, `select coalesce(sum(debit - credit), 0) from public.journal_lines where account = '1100'`))).toBe(100);
  });

  it("paying the whole balance in the early window earns the discount; overpayment becomes customer credit", async () => {
    // A: 210, 5 % discount → 199.50 settles it; pay 250 → 50.50 credit.
    const out = await asUser(db, cashier, (tx) =>
      scalar<{ allocated: number; discount: number; leftover: number }>(tx, `select public.cashier_take_payment($1, $2)`, [
        shift,
        JSON.stringify({ parcel_id: parcelA, amount: 250, currency: "USD", method: "cash" }),
      ]),
    );
    expect(Number(out.discount)).toBe(10.5);
    expect(Number(out.allocated)).toBe(199.5);
    expect(Number(out.leftover)).toBe(50.5);
    const a = await invoice(invA);
    expect(a.status).toBe("paid");
    const l = await ledger();
    expect(l.dr).toBe(l.cr);
    expect(l.debtors).toBe(l.open);
    expect(l.credit).toBe(50.5);
  });

  it("SOS payments convert at the day's rate; without a rate they are refused", async () => {
    await expectError(
      asUser(db, cashier, (tx) => tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: parcelB, amount: 57100, currency: "SOS", method: "cash" })])),
      "CONFLICT: no_fx_rate",
    );
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.fx_rate_set('SOS', current_date, 571)`)), "PERMISSION_DENIED");
    await asUser(db, accountant, (tx) => tx.query(`select public.fx_rate_set('SOS', current_date, 571)`));
    const out = await asUser(db, cashier, (tx) =>
      scalar<{ amount_base: number }>(tx, `select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: parcelB, amount: 57100, currency: "SOS", method: "cash" })]),
    );
    expect(Number(out.amount_base)).toBe(100);
    expect(Number((await invoice(invB)).balance)).toBe(310);
  });

  it("closing a shift compares expected and counted cash; a big gap needs a note; a second person approves", async () => {
    // float 20 + 100 + 250 + 100 = 470 expected
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.shift_close($1, 400)`, [shift])), "VALIDATION: note_required");
    const out = await asUser(db, cashier, (tx) => scalar<{ expected: number; difference: number }>(tx, `select public.shift_close($1, 469, null)`, [shift]));
    expect(Number(out.expected)).toBe(470);
    expect(Number(out.difference)).toBe(-1);
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.shift_approve($1)`, [shift])), "PERMISSION_DENIED");
    await asUser(db, finance, (tx) => tx.query(`select public.shift_approve($1)`, [shift]));
    expect(await scalar<string>(db, `select status::text from public.cashier_shifts where id = $1`, [shift])).toBe("approved");
  });

  it("online: anyone with the QR token starts an intent; a signed webhook records it once", async () => {
    await db.query(`update public.payment_providers set enabled = true where code = 'test'`);
    const token = await scalar<string>(db, `select token from public.invoice_tokens where invoice_id = $1`, [invB]);
    await expectError(as(db, "anon", {}, (tx) => tx.query(`select public.payment_intent_create(null, $1, 'test', '12345')`, [token])), "VALIDATION: phone");
    const intent = await as(db, "anon", {}, (tx) =>
      scalar<{ intent_id: string; amount: number }>(tx, `select public.payment_intent_create(null, $1, 'test', '+252615550101')`, [token]),
    );
    expect(Number(intent.amount)).toBe(310);
    await expectError(
      as(db, "anon", {}, (tx) => tx.query(`select public.webhook_ingest('test', 'e1', true, '{}', '{}')`)),
      "permission denied",
    );
    const event = { status: "succeeded", intent_id: intent.intent_id, provider_ref: "TX-1", amount: 310, currency: "USD", phone: "+252615550101" };
    const bad = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'e1', false, $1, $1)`, [JSON.stringify(event)]));
    expect(bad.result).toBe("bad_signature");
    // A forged event with the real event id must not block the genuine one.
    const bad2 = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'e1', false, $1, $1)`, [JSON.stringify(event)]));
    expect(bad2.result).toBe("bad_signature");
    const ok = await asService(db, (tx) => scalar<{ result: string; receipt_no: string }>(tx, `select public.webhook_ingest('test', 'e1', true, $1, $1)`, [JSON.stringify(event)]));
    expect(ok.result).toBe("recorded");
    expect(ok.receipt_no).toMatch(/^ONL-2026-/);
    const again = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'e1', true, $1, $1)`, [JSON.stringify(event)]));
    expect(again.result).toBe("duplicate");
    const replay = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'e2', true, $1, $1)`, [JSON.stringify(event)]));
    expect(replay.result).toBe("already_recorded");
    expect((await invoice(invB)).status).toBe("paid");
    const status = await as(db, "anon", {}, (tx) => scalar<{ status: string; receipt_no: string }>(tx, `select public.payment_intent_status($1)`, [intent.intent_id]));
    expect(status.status).toBe("succeeded");
    expect(status.receipt_no).toBe(ok.receipt_no);
  });

  it("money without an intent is matched by PUN reference, otherwise it waits as unmatched until matched", async () => {
    const byRef = await asService(db, (tx) =>
      scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'e3', true, $1, '{}')`, [
        JSON.stringify({ status: "succeeded", provider_ref: "TX-3", amount: 5, currency: "USD", reference: "bn-hdn-012-000002" }),
      ]),
    );
    expect(byRef.result).toBe("recorded_by_reference");
    const lost = await asService(db, (tx) =>
      scalar<{ result: string; payment_id: string }>(tx, `select public.webhook_ingest('test', 'e4', true, $1, '{}')`, [
        JSON.stringify({ status: "succeeded", provider_ref: "TX-4", amount: 7, currency: "USD", reference: "garbled" }),
      ]),
    );
    expect(lost.result).toBe("unmatched");
    const seenByCashier = await asUser(db, cashier, (tx) => tx.query(`select id from public.payments where id = $1`, [lost.payment_id]));
    expect(seenByCashier.rows).toHaveLength(0);
    await asUser(db, finance, (tx) => tx.query(`select public.payment_match($1, $2)`, [lost.payment_id, parcelB]));
    expect(await scalar<string>(db, `select status::text from public.payments where id = $1`, [lost.payment_id])).toBe("completed");
    const l = await ledger();
    expect(l.dr).toBe(l.cr);
    expect(l.debtors).toBe(l.open);
  });

  it("reversals need a second person; they reopen the invoice and mirror the journal", async () => {
    const pay = await scalar<string>(db, `select id from public.payments where provider_ref = 'TX-1'`);
    const req = await asUser(db, finance, (tx) => scalar<string>(tx, `select public.reversal_request($1, 'Duplicate charge on the phone')`, [pay]));
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.reversal_decide($1, true, 'ok')`, [req])), "MAKER_CHECKER");
    await asUser(db, finance2, (tx) => tx.query(`select public.reversal_decide($1, true, 'Operator confirmed')`, [req]));
    const b = await invoice(invB);
    expect(b.status).toBe("partially_paid");
    expect(Number(b.balance)).toBe(310);
    const l = await ledger();
    expect(l.dr).toBe(l.cr);
    expect(l.debtors).toBe(l.open);
  });

  it("owners see their own payments; strangers see none", async () => {
    const mine = await asUser(db, citizen, (tx) => tx.query(`select id from public.payments`), "aal1");
    expect(mine.rows).toHaveLength(1);
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    expect((await asUser(db, stranger, (tx) => tx.query(`select id from public.payments`), "aal1")).rows).toHaveLength(0);
  });

  it("reconciliation flags matched, mismatched and missing lines", async () => {
    const out = await asUser(db, accountant, (tx) =>
      scalar<{ summary: Record<string, number> }>(tx, `select public.reconciliation_run('test', current_date - 1, current_date + 1, $1)`, [
        JSON.stringify([
          { provider_ref: "TX-3", amount: 5 },
          { provider_ref: "TX-4", amount: 8 },
          { provider_ref: "TX-9", amount: 1 },
        ]),
      ]),
    );
    expect(out.summary).toEqual({ matched: 1, amount_mismatch: 1, missing_in_system: 1 });
  });

  it("locked months refuse postings; manual journals must balance; the trial balance balances", async () => {
    await expectError(
      asUser(db, accountant, (tx) => tx.query(`select public.journal_manual(current_date, 'Bad', $1)`, [JSON.stringify([{ account: "1130", debit: 10 }, { account: "1100", credit: 9 }])])),
      "VALIDATION: unbalanced",
    );
    await asUser(db, accountant, (tx) => tx.query(`select public.journal_manual(current_date, 'Bank deposit of cash', $1)`, [JSON.stringify([{ account: "1130", debit: 400 }, { account: "1100", credit: 400 }])]));
    const tb = await asUser(db, accountant, (tx) => tx.query<{ debit: string; credit: string }>(`select * from public.trial_balance(current_date - 30, current_date + 1)`));
    const dr = tb.rows.reduce((s, r) => s + Number(r.debit), 0);
    const cr = tb.rows.reduce((s, r) => s + Number(r.credit), 0);
    expect(dr).toBeCloseTo(cr, 2);
    const today = new Date();
    await asUser(db, accountant, (tx) => tx.query(`select public.period_set($1, $2, true)`, [today.getFullYear(), today.getMonth() + 1]));
    await expectError(
      asUser(db, accountant, (tx) => tx.query(`select public.journal_manual(current_date, 'Too late', $1)`, [JSON.stringify([{ account: "1130", debit: 1 }, { account: "1100", credit: 1 }])])),
      "CONFLICT: period_locked",
    );
    await asUser(db, accountant, (tx) => tx.query(`select public.period_set($1, $2, false)`, [today.getFullYear(), today.getMonth() + 1]));
  });
  // Last, as it adds a payment: the cases above count on their own amounts.
  it("receipts count per prefix: renaming a desk's code doesn't restart its numbers", async () => {
    const before = await scalar<number>(db, `select count(*)::int from public.payments where receipt_no like 'HDN1-2026-%'`);
    await db.query(`update public.points_of_sale set code = 'HDNX' where id = $1`, [pos]);
    const open = await scalar<string>(db, `select id from public.cashier_shifts where pos_id = $1 and status = 'open' limit 1`, [pos]).catch(() => null);
    const s = open ?? (await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos])));
    const out = await asUser(db, cashier, (tx) =>
      scalar<{ receipt_no: string }>(tx, `select public.cashier_take_payment($1, $2)`, [
        s,
        JSON.stringify({ parcel_id: parcelB, amount: 1, currency: "USD", method: "cash", payer_name: "Xasan", confirm_duplicate: true }),
      ]),
    );
    expect(out.receipt_no).toBe(`HDN1-2026-${String(before + 1).padStart(6, "0")}`);
  });
});
