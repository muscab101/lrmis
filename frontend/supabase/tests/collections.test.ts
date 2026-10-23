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

describe("collections, stage 2: verify, dispute, corrections", () => {
  const receipt = (ref: string) => scalar<string>(db, `select id from public.payments where reference = $1`, [ref]);
  const row = (id: string) => scalar<Record<string, string>>(db, `select row_to_json(p) from public.payments p where id = $1`, [id]);

  it("payments start Pending; a finance officer verifies, never the cashier who took it", async () => {
    const pay = await receipt("evc1001");
    expect((await row(pay)).verify_status).toBe("pending");
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.payment_verify($1)`, [[pay]])), "PERMISSION_DENIED");
    const n = await asUser(db, officer, (tx) => scalar<number>(tx, `select public.payment_verify($1)`, [[pay]]));
    expect(n).toBe(1);
    expect((await row(pay)).verify_status).toBe("verified");
    const q = await asUser(db, officer, (tx) => tx.query<{ channel: string; evidence: string }>(`select * from public.collections_queue('verified', current_date, current_date)`));
    expect(q.rows.map((r) => r.channel)).toEqual(["evc_plus"]);
    expect(Number(q.rows[0]!.evidence)).toBe(2);
  });

  it("a dispute needs a reason; verifying a disputed payment needs a note", async () => {
    const pay = await scalar<string>(db, `select id from public.payments where wallet = 'zaad'`);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.payment_dispute($1, 'no')`, [pay])), "VALIDATION: reason");
    await asUser(db, officer, (tx) => tx.query(`select public.payment_dispute($1, 'Not on the ZAAD statement')`, [pay]));
    expect((await row(pay)).verify_status).toBe("disputed");
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.payment_verify($1)`, [[pay]])), "VALIDATION: note_required");
  });

  it("a correction needs a reason and a Finance Manager's approval; the original stays on record and the ledger follows", async () => {
    const pay = await scalar<string>(db, `select id from public.payments where wallet = 'zaad'`);
    await expectError(
      asUser(db, cashier, (tx) => tx.query(`select public.payment_correction_request($1, $2, 'Wrong wallet')`, [pay, JSON.stringify({ wallet: "edahab" })])),
      "PERMISSION_DENIED",
    );
    // The cashier who took it asks: it was eDahab, and the reference was mistyped.
    const id = await asUser(db, cashier2, (tx) =>
      scalar<string>(tx, `select public.payment_correction_request($1, $2, 'Payer used eDahab, not ZAAD')`, [pay, JSON.stringify({ wallet: "edahab", reference: "ED-77" })]),
    );
    await expectError(asUser(db, cashier2, (tx) => tx.query(`select public.payment_correction_request($1, $2, 'Again please')`, [pay, JSON.stringify({ payer_name: "X" })])), "CONFLICT: correction_pending");
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.payment_correction_decide($1, true)`, [id])), "PERMISSION_DENIED");
    await asUser(db, manager, (tx) => tx.query(`select public.payment_correction_decide($1, true, 'Checked the eDahab SMS')`, [id]));
    const p = await row(pay);
    expect(p).toMatchObject({ wallet: "edahab", reference: "ED-77", provider: "edahab", verify_status: "pending" });
    const c = await scalar<{ before: { wallet: string; reference: string }; status: string }>(db, `select row_to_json(c) from public.payment_corrections c where id = $1`, [id]);
    expect(c.status).toBe("approved");
    expect(c.before).toMatchObject({ wallet: "zaad", reference: "EVC1001" });

    // Cash recorded as a bank transfer: moving it posts a balanced journal from cash to the bank clearing account.
    const cash = await scalar<string>(db, `select id from public.payments where method = 'cash' order by received_at limit 1`);
    const c2 = await asUser(db, officer, (tx) =>
      scalar<string>(tx, `select public.payment_correction_request($1, $2, 'Paid by bank, cashier picked cash')`, [cash, JSON.stringify({ method: "bank_transfer", reference: "BK-555" })]),
    );
    await expectError(asUser(db, manager, (tx) => tx.query(`select public.payment_correction_decide($1, false, 'no')`, [c2])), "VALIDATION: note_required");
    await asUser(db, manager, (tx) => tx.query(`select public.payment_correction_decide($1, true)`, [c2]));
    const j = await scalar<{ dr: string; cr: string; accounts: string[] }>(
      db,
      `select json_build_object('dr', sum(l.debit), 'cr', sum(l.credit), 'accounts', array_agg(l.account order by l.debit desc))
         from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.source = 'payment_correction' and e.source_id = $1`,
      [cash],
    );
    expect(Number(j.dr)).toBe(Number(j.cr));
    expect(j.accounts).toEqual(["1130", "1100"]);
  });
});

describe("collections, stage 3: reconcile a cashier's day", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("shows recorded money per way of paying, with a suggested actual", async () => {
    const days = await asUser(db, officer, (tx) => tx.query<{ cashier_id: string; recorded: string; status: string | null }>(`select * from public.cashier_days(current_date, current_date)`));
    expect(days.rows.map((d) => d.cashier_id).sort()).toEqual([cashier, cashier2].sort());
    const s = await asUser(db, officer, (tx) => tx.query<{ channel: string; payments: string; recorded: string }>(`select * from public.cashier_day_summary($1, current_date)`, [cashier]));
    const by = Object.fromEntries(s.rows.map((r) => [r.channel, Number(r.recorded)]));
    // cashier: EVC 40, then cash 30 (later corrected to bank transfer) and cash 30.
    expect(by).toMatchObject({ cash: 30, evc_plus: 40, bank_transfer: 30, zaad: 0 });
  });

  it("works out shortage and excess per way of paying; a difference needs a note; the cashier can't reconcile their own day", async () => {
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.cashier_recon_submit($1, current_date, '{}')`, [cashier])), "PERMISSION_DENIED");
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.cashier_recon_submit($1, current_date, $2)`, [cashier, JSON.stringify({ cash: 30 })])), "VALIDATION: actual_missing");
    const actual = JSON.stringify({ cash: 25, evc_plus: 40, bank_transfer: 32 });
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.cashier_recon_submit($1, current_date, $2)`, [cashier, actual])), "VALIDATION: note_required");
    const id = await asUser(db, officer, (tx) => scalar<string>(tx, `select public.cashier_recon_submit($1, current_date, $2, 'Drawer $5 short; bank shows $2 extra')`, [cashier, actual]));
    const lines = await db.query<{ channel: string; recorded: string; actual: string; difference: string; shortage: string; excess: string }>(
      `select channel, recorded, actual, difference, shortage, excess from public.cashier_reconciliation_lines where reconciliation_id = $1 order by channel`,
      [id],
    );
    const by = Object.fromEntries(lines.rows.map((l) => [l.channel, [l.recorded, l.actual, l.difference, l.shortage, l.excess].map(Number)]));
    expect(by).toEqual({ bank_transfer: [30, 32, 2, 0, 2], cash: [30, 25, -5, 5, 0], evc_plus: [40, 40, 0, 0, 0] });
    const head = await scalar<{ recorded: string; actual: string; difference: string }>(db, `select row_to_json(r) from public.cashier_reconciliations r where id = $1`, [id]);
    expect([head.recorded, head.actual, head.difference].map(Number)).toEqual([100, 97, -3]);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.cashier_recon_submit($1, current_date, $2, 'again')`, [cashier, actual])), "CONFLICT: already_reconciled");
  });

  it("a Finance Manager approves: the day's payments become Reconciled, except disputed ones; they can't be corrected after", async () => {
    const id = await scalar<string>(db, `select id from public.cashier_reconciliations where cashier_id = $1`, [cashier]);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.cashier_recon_decide($1, true)`, [id])), "PERMISSION_DENIED");
    await asUser(db, manager, (tx) => tx.query(`select public.cashier_recon_decide($1, true, 'Shortage recovered from the cashier')`, [id]));
    const st = await db.query<{ verify_status: string }>(`select verify_status from public.payments where created_by = $1`, [cashier]);
    expect(st.rows.every((r) => r.verify_status === "reconciled")).toBe(true);
    const pay = await scalar<string>(db, `select id from public.payments where created_by = $1 limit 1`, [cashier]);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.payment_correction_request($1, '{"payer_name":"X"}', 'Spelling of the name')`, [pay])), "CONFLICT: reconciled");
    expect(today).toMatch(/^\d{4}/);
  });

  it("a statement upload matches desk wallet payments by their reference and verifies them", async () => {
    // cashier2's eDahab payment (reference ED-77 after the correction) is pending again.
    const r = await asUser(db, officer, (tx) =>
      scalar<{ summary: Record<string, number> }>(tx, `select public.reconciliation_run('edahab', current_date, current_date, $1)`, [JSON.stringify([{ provider_ref: "ed-77", amount: 25 }, { provider_ref: "ED-99", amount: 5 }])]),
    );
    expect(r.summary).toMatchObject({ matched: 1, missing_in_system: 1 });
    expect(await scalar<string>(db, `select verify_status from public.payments where reference = 'ED-77'`)).toBe("verified");
  });
});

describe("staff names", () => {
  it("finance staff see the names on collection records; others can't", async () => {
    const r = await asUser(db, officer, (tx) => tx.query<{ full_name: string }>(`select * from public.staff_names($1)`, [[cashier, manager]]));
    expect(r.rows).toHaveLength(2);
    const outsider = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
    await expectError(asUser(db, outsider, (tx) => tx.query(`select * from public.staff_names($1)`, [[cashier]])), "PERMISSION_DENIED");
  });
});

describe("collections, stage 4: reports", () => {
  it("daily / weekly / monthly totals split by way of paying; verified-only by default", async () => {
    const q = (args: string) => asUser(db, officer, (tx) => tx.query<Record<string, string>>(`select * from public.report_collections(current_date, current_date, ${args})`));
    const all = (await q("'day', 'all'")).rows;
    expect(all).toHaveLength(1);
    const a = all[0]!;
    const cols = ["cash", "evc_plus", "edahab", "zaad", "bank_transfer", "card", "other"].map((c) => Number(a[c]));
    // Grand total = Cash + EVC Plus + eDahab + ZAAD + Bank (+ card + other).
    expect(cols.reduce((s, n) => s + n, 0)).toBe(Number(a.total));
    expect(Number(a.total)).toBe(125);
    const verified = (await q("'week', 'verified'")).rows[0]!;
    // cashier's 100 is reconciled; cashier2's eDahab 25 was verified by the statement.
    expect(Number(verified.total)).toBe(125);
    const month = (await q("'month', 'all'")).rows[0]!;
    expect(new Date(month.period as unknown as string).getUTCDate()).toBe(1);
    await expectError(q("'year', 'all'"), "VALIDATION: by");
  });

  it("compares with the period just before, and reports by cashier with shortage and excess", async () => {
    const c = await asUser(db, officer, (tx) => tx.query<{ channel: string; current_amount: string; previous_amount: string }>(`select * from public.report_collections_compare(current_date, current_date, 'all')`));
    expect(c.rows.map((r) => r.channel)).toEqual(["cash", "evc_plus", "edahab", "zaad", "bank_transfer", "card", "other"]);
    expect(c.rows.reduce((s, r) => s + Number(r.previous_amount), 0)).toBe(0);
    const by = await asUser(db, officer, (tx) => tx.query<{ cashier_id: string; total: string; shortage: string; excess: string; reconciled_days: string }>(`select * from public.report_collections_cashier(current_date, current_date, 'all')`));
    const me = by.rows.find((r) => r.cashier_id === cashier)!;
    expect([me.total, me.shortage, me.excess, me.reconciled_days].map(Number)).toEqual([100, 5, 2, 1]);
  });

  it("shortages, unreconciled payments and the verification/approval facts", async () => {
    const s = await asUser(db, officer, (tx) => tx.query<{ cash: string; bank_transfer: string; shortage: string; status: string }>(`select * from public.report_cashier_shortages(current_date, current_date)`));
    expect(s.rows).toHaveLength(1);
    expect([s.rows[0]!.cash, s.rows[0]!.bank_transfer, s.rows[0]!.shortage].map(Number)).toEqual([-5, 2, 5]);
    const u = await asUser(db, officer, (tx) => tx.query<{ verify_status: string }>(`select * from public.report_unreconciled(current_date, current_date)`));
    expect(u.rows.map((r) => r.verify_status)).toEqual(["verified"]);
    const st = await asUser(db, officer, (tx) => scalar<{ reconciled: { n: number }; approved: number; approvers: string }>(tx, `select public.report_collections_status(current_date, current_date)`));
    expect(st.reconciled.n).toBe(3);
    expect(st.approved).toBe(1);
    expect(st.approvers).toBeTruthy();
  });
});

describe("payments report by wallet", () => {
  it("filters the Payments listing by EVC Plus, eDahab or ZAAD", async () => {
    const q = (m: string) => asUser(db, officer, (tx) => tx.query(`select * from public.report_payments(current_date, current_date, null, null, null, null, $1)`, [m]));
    expect((await q("edahab")).rows).toHaveLength(1);
    expect((await q("evc_plus")).rows).toHaveLength(1);
    expect((await q("mobile_money")).rows).toHaveLength(2);
  });
});

describe("collections, stage 5: dashboard", () => {
  it("today, week and month, per way of paying, statuses, shortages and what waits", async () => {
    const d = await asUser(db, officer, (tx) =>
      scalar<{ today: { all: number; n: number }; week: { all: number }; month: { all: number; verified: number }; channels: Record<string, number>; status: Record<string, { n: number }>; shortage: number; excess: number; recon_waiting: number }>(
        tx,
        `select public.collections_dashboard()`,
      ),
    );
    expect(Number(d.today.all)).toBe(125);
    expect(Number(d.week.all)).toBe(125);
    expect(Number(d.month.verified)).toBe(125);
    expect(Object.values(d.channels).reduce((s, n) => s + Number(n), 0)).toBe(125);
    expect(d.status.reconciled!.n).toBe(3);
    expect([Number(d.shortage), Number(d.excess)]).toEqual([5, 2]);
    expect(d.recon_waiting).toBe(0);
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.collections_dashboard()`)), "PERMISSION_DENIED");
  });
});
