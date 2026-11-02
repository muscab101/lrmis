import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let valuer: string;
let biller: string;
let biller2: string;
let finance: string;
let citizen: string;
let hodan: string;
let nbhd: string;
let parcelA: string;
let parcelB: string;
let parcelC: string;
let propertyTax: string;
let certificateFee: string;
let run1: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
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

const inv = (parcel: string) =>
  scalar<{ id: string; number: string; total: string; paid: string; credited: string; balance: string; status: string; penalty_applied_at: string | null }>(
    db,
    `select row_to_json(i) from public.invoices i where parcel_id = $1 and fee_type_id = $2`,
    [parcel, propertyTax],
  );

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
  biller2 = await createStaff(db, admin, "biller2@gmail.com", ["billing_officer"], [hodan]);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Owner" });
  propertyTax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  certificateFee = await scalar<string>(db, `select id from public.fee_types where code = 'certificate_fee'`);

  parcelA = await registeredParcel(1, 400, citizen); // 400 × 0.5 + 10 = 210
  parcelB = await registeredParcel(2, 1000); // 1000 × 0.5 + 10 = 510
  parcelC = await registeredParcel(3, 200); // not assessed → exception
  await asUser(db, valuer, async (tx) => {
    await tx.query(`select public.valuation_set_rate($1, 'residential', false, 0.5, 10, '2026-01-01')`, [nbhd]);
    await tx.query(`select public.assess_parcel($1, 2026)`, [parcelA]);
    await tx.query(`select public.assess_parcel($1, 2026)`, [parcelB]);
  });
});

describe("billing (Phase 6)", () => {
  it("a run previews count, total and exceptions; only billing staff create it", async () => {
    await expectError(
      asUser(db, valuer, (tx) => tx.query(`select public.billing_run_create($1)`, [JSON.stringify({ year: 2026, fee_type_id: propertyTax, district_ids: [hodan] })])),
      "PERMISSION_DENIED",
    );
    const out = await asUser(db, biller, (tx) =>
      scalar<{ id: string; number: string; preview: { parcels: number; count: number; total: number; exceptions: Record<string, number> } }>(
        tx,
        `select public.billing_run_create($1)`,
        [JSON.stringify({ year: 2026, fee_type_id: propertyTax, district_ids: [hodan], due_date: "2026-12-31" })],
      ),
    );
    run1 = out.id;
    expect(out.number).toBe("BR-2026-001");
    expect(out.preview.parcels).toBe(3);
    expect(out.preview.count).toBe(2);
    expect(Number(out.preview.total)).toBe(720);
    expect(out.preview.exceptions.no_assessment).toBe(1);
  });

  it("submit → approval by someone else (finance) → generate; the creator can't approve", async () => {
    await asUser(db, biller, (tx) => tx.query(`select public.billing_run_submit($1)`, [run1]));
    await expectError(asUser(db, biller, (tx) => tx.query(`select public.billing_run_approve($1)`, [run1])), "PERMISSION_DENIED");
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.billing_run_generate($1)`, [run1])), "CONFLICT: status");
    await asUser(db, finance, (tx) => tx.query(`select public.billing_run_approve($1)`, [run1]));
    const gen = await asUser(db, finance, (tx) => scalar<{ created: number; total: number }>(tx, `select public.billing_run_generate($1)`, [run1]));
    expect(gen).toEqual({ created: 2, total: 720 });
    const run = await scalar<{ status: string; invoice_count: number; total: string }>(db, `select row_to_json(r) from public.billing_runs r where id = $1`, [run1]);
    expect(run.status).toBe("issued");
    expect(run.invoice_count).toBe(2);
    const a = await inv(parcelA);
    expect(a.number).toMatch(/^INV-2026-00000[12]$/);
    expect(Number(a.total)).toBe(210);
    const lines = await scalar<number>(db, `select sum(amount)::numeric from public.invoice_lines where invoice_id = $1`, [a.id]);
    expect(Number(lines)).toBe(210);
    expect(await scalar<number>(db, `select count(*)::int from public.jobs where kind = 'sms.invoice_issued'`)).toBe(2);
  });

  it("one invoice per parcel, fee and period: a second run finds nothing to bill", async () => {
    const out = await asUser(db, biller, (tx) =>
      scalar<{ id: string; preview: { count: number; exceptions: Record<string, number> } }>(tx, `select public.billing_run_create($1)`, [
        JSON.stringify({ year: 2026, fee_type_id: propertyTax, district_ids: [hodan] }),
      ]),
    );
    expect(out.preview.count).toBe(0);
    expect(out.preview.exceptions.already_invoiced).toBe(2);
    await expectError(asUser(db, biller, (tx) => tx.query(`select public.billing_run_submit($1)`, [out.id])), "CONFLICT: nothing_to_bill");
    await expectError(
      db.query(`insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('X', $1, $2, $3, '2026', current_date, 1)`, [
        parcelA,
        hodan,
        propertyTax,
      ]),
      "duplicate key",
    );
  });

  it("owners see their own invoices; other citizens see none; the pay link works without signing in", async () => {
    const mine = await asUser(db, citizen, (tx) => tx.query(`select id from public.invoices`), "aal1");
    expect(mine.rows).toHaveLength(1);
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    const theirs = await asUser(db, stranger, (tx) => tx.query(`select id from public.invoices`), "aal1");
    expect(theirs.rows).toHaveLength(0);
    const a = await inv(parcelA);
    const link = await asUser(db, citizen, (tx) => scalar<string>(tx, `select public.invoice_pay_link($1)`, [a.id]), "aal1");
    expect(link).toMatch(/^\/pay\/[0-9a-f]{64}$/);
    const tokenRead = await asUser(db, citizen, (tx) => tx.query(`select * from public.invoice_tokens`).then(() => "read", () => "denied"), "aal1");
    expect(tokenRead).toBe("denied");
    const pub = await as(db, "anon", {}, (tx) => scalar<{ number: string; balance: number }>(tx, `select public.invoice_by_token($1)`, [link.slice(5)]));
    expect(pub.number).toBe(a.number);
    expect(Number(pub.balance)).toBe(210);
  });

  it("credit notes need a second approver and reduce the balance", async () => {
    const b = await inv(parcelB);
    await expectError(asUser(db, biller, (tx) => tx.query(`select public.credit_note_request($1, 600, 'Area was measured wrongly')`, [b.id])), "VALIDATION: amount");
    const cn = await asUser(db, biller, (tx) => scalar<string>(tx, `select public.credit_note_request($1, 110, 'Area was measured wrongly')`, [b.id]));
    await asUser(db, finance, (tx) => tx.query(`select public.credit_note_decide($1, true, 'Checked the survey')`, [cn]));
    const after = await inv(parcelB);
    expect(Number(after.credited)).toBe(110);
    expect(Number(after.balance)).toBe(400);
    expect(after.status).toBe("partially_paid");
  });

  it("payment plans split the balance into instalments and protect it from penalties once approved", async () => {
    const b = await inv(parcelB);
    const plan = await asUser(db, biller, (tx) => scalar<string>(tx, `select public.payment_plan_request($1, $2, 3, current_date + 1, 'Monthly')`, [parcelB, [b.id]]));
    const sums = await scalar<{ n: number; total: string }>(db, `select json_build_object('n', count(*), 'total', sum(amount)) from public.payment_plan_installments where plan_id = $1`, [plan]);
    expect(sums.n).toBe(3);
    expect(Number(sums.total)).toBe(400);
    await expectError(asUser(db, biller, (tx) => tx.query(`select public.payment_plan_request($1, $2, 2, current_date + 1)`, [parcelB, [b.id]])), "CONFLICT: in_payment_plan");
    await expectError(asUser(db, biller, (tx) => tx.query(`select public.payment_plan_decide($1, true, 'ok')`, [plan])), "PERMISSION_DENIED");
    await asUser(db, finance, (tx) => tx.query(`select public.payment_plan_decide($1, true, 'Agreed with owner')`, [plan]));
    expect(await scalar<string>(db, `select status::text from public.payment_plans where id = $1`, [plan])).toBe("active");
  });

  it("late penalties apply once after due + grace, never to invoices in a plan", async () => {
    // Due 2026-12-31 + 30 days grace → penalty on 2027-02-15 for A (in no plan), not for B (in a plan).
    const n = await asUser(db, biller, (tx) => scalar<number>(tx, `select public.apply_late_penalties('2027-02-15')`));
    expect(n).toBe(1);
    const a = await inv(parcelA);
    expect(Number(a.total)).toBe(220.5); // 210 + 5 %
    expect(a.penalty_applied_at).not.toBeNull();
    expect(Number((await inv(parcelB)).total)).toBe(510);
    const again = await asService(db, (tx) => scalar<number>(tx, `select public.apply_late_penalties('2027-03-01')`));
    expect(again).toBe(0);
  });

  it("payments settle invoices (Phase 7 hand-off); paid invoices can't be cancelled", async () => {
    const a = await inv(parcelA);
    const applied = await scalar<string>(db, `select private.invoice_apply_payment($1, 500)`, [a.id]);
    expect(Number(applied)).toBe(220.5);
    const paid = await inv(parcelA);
    expect(paid.status).toBe("paid");
    expect(Number(paid.balance)).toBe(0);
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.invoice_cancel($1, 'Wrong parcel')`, [a.id])), "CONFLICT: has_payments");
  });

  it("one-off fee invoices; their creator can't cancel them", async () => {
    const out = await asUser(db, finance, (tx) => scalar<{ id: string; number: string }>(tx, `select public.invoice_create($1, $2, null, 'Certificate reprint')`, [parcelC, certificateFee]));
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [out.id]))).toBe(20);
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.invoice_create($1, $2, 100)`, [parcelC, propertyTax])), "VALIDATION: fee_type");
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.invoice_cancel($1, 'Raised twice')`, [out.id])), "MAKER_CHECKER");
    const second = await createStaff(db, admin, "finance2@gmail.com", ["finance_manager"], "all");
    await asUser(db, second, (tx) => tx.query(`select public.invoice_cancel($1, 'Raised twice')`, [out.id]));
    expect(await scalar<string>(db, `select status::text from public.invoices where id = $1`, [out.id])).toBe("cancelled");
  });

  it("drafts can be cancelled with a reason; issued runs can't", async () => {
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.billing_run_cancel($1, 'x')`, [run1])), "CONFLICT: status");
    const draft = await asUser(db, biller2, (tx) =>
      scalar<{ id: string }>(tx, `select public.billing_run_create($1)`, [JSON.stringify({ year: 2026, period: "2026", fee_type_id: propertyTax, district_ids: [hodan] })]),
    );
    await expectError(asUser(db, biller2, (tx) => tx.query(`select public.billing_run_cancel($1, '')`, [draft.id])), "VALIDATION: note_required");
    await asUser(db, biller2, (tx) => tx.query(`select public.billing_run_cancel($1, 'Duplicate of BR-2026-001')`, [draft.id]));
  });
});

describe("billing runs that work themselves out (0137)", () => {
  let run: string;
  let price: number;

  it("prices land without an assessment from its size × its type's price, for the chosen places", async () => {
    price = Number(await scalar<string>(db, `select amount from public.property_grades where code = 'villa'`));
    await db.query(`update public.parcels set property_type = 'villa', plot_width_m = 10, plot_length_m = 12 where id = $1`, [parcelA]);
    const section = await scalar<string>(db, `select sc.section_id from public.neighbourhoods n join public.sectors sc on sc.id = n.sector_id where n.id = $1`, [nbhd]);
    const out = await asUser(db, biller, (tx) =>
      scalar<{ id: string; preview: { count: number; total: number } }>(tx, `select public.billing_run_create($1)`, [
        JSON.stringify({ year: 2030, fee_type_id: propertyTax, district_ids: [hodan], section_ids: [section], due_date: "2030-12-31" }),
      ]),
    );
    run = out.id;
    expect(out.preview.count).toBe(1);
    expect(Number(out.preview.total)).toBe(120 * price);
  });

  it("shows the run in batches, one per neighbourhood, with what is billed and what is skipped", async () => {
    const b = await asUser(db, biller, (tx) => tx.query<{ bills: number; total: string; skipped: number }>(`select * from public.billing_run_batches($1)`, [run]));
    expect(b.rows).toHaveLength(1);
    expect([b.rows[0]!.bills, Number(b.rows[0]!.total), b.rows[0]!.skipped]).toEqual([1, 120 * price, 2]);
    // Each batch names its district (and section and sector), for the place filter (0138).
    expect((b.rows[0] as unknown as { district_id: string }).district_id).toBe(hodan);
    const bills = await asUser(db, biller, (tx) => tx.query<{ pun: string; exception: string | null }>(`select * from public.billing_run_batch_bills($1, $2)`, [run, nbhd]));
    expect(bills.rows[0]!.exception).toBeNull();
  });

  it("issues straight away without the approval step", async () => {
    const r = await asUser(db, biller, (tx) => scalar<{ created: number }>(tx, `select public.billing_run_issue_now($1)`, [run]));
    expect(r.created).toBe(1);
    expect(await scalar<string>(db, `select status::text from public.billing_runs where id = $1`, [run])).toBe("issued");
    const b = await asUser(db, biller, (tx) => tx.query<{ bills: number }>(`select * from public.billing_run_batches($1)`, [run]));
    expect(b.rows[0]!.bills).toBe(1);
  });

  it("the yearly job makes no second run for a district that already has one", async () => {
    const year = new Date().getFullYear();
    const count = () =>
      scalar<number>(db, `select count(*)::int from public.billing_runs where period = $1 and fee_type_id = $2 and $3 = any (district_ids) and status <> 'cancelled'`, [
        String(year),
        propertyTax,
        hodan,
      ]);
    const before = await count();
    await db.query(`select private.billing_auto_year()`);
    expect(await count()).toBe(Math.max(before, 1));
  });
});

describe("billing runs never charge land twice (0141)", () => {
  const parcelBill = async (year: number) => {
    const bill = await scalar<string>(db, `select id from public.fee_types where code = 'property_bill'`);
    await db.query(
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
       values ($1, $2, $3, $4, $5, $6, $6, 36)`,
      [`INV-TEST-${year}`, parcelA, hodan, bill, `${year}-03-01/1`, `${year}-03-01`],
    );
  };
  const preview = (year: number) =>
    asUser(db, biller, (tx) =>
      scalar<{ id: string; preview: { count: number; exceptions: Record<string, number> } }>(tx, `select public.billing_run_create($1)`, [
        JSON.stringify({ year, fee_type_id: propertyTax, district_ids: [hodan], due_date: "2040-12-31" }),
      ]),
    );

  it("land with a registration tax bill in the year is skipped for that year, and billed the next", async () => {
    await parcelBill(2032);
    const same = await preview(2032);
    expect(same.preview.exceptions.already_invoiced).toBeGreaterThanOrEqual(1);
    const bills = await asUser(db, biller, (tx) => tx.query<{ parcel_id: string; exception: string | null }>(`select * from public.billing_run_batch_bills($1, $2)`, [same.id, nbhd]));
    expect(bills.rows.find((r) => r.parcel_id === parcelA)!.exception).toBe("already_invoiced");
    const next = await asUser(db, biller, (tx) => scalar<{ id: string }>(tx, `select public.billing_run_create($1)`, [JSON.stringify({ year: 2033, fee_type_id: propertyTax, district_ids: [hodan], due_date: "2040-12-31" })]));
    const later = await asUser(db, biller, (tx) => tx.query<{ parcel_id: string; exception: string | null }>(`select * from public.billing_run_batch_bills($1, $2)`, [next.id, nbhd]));
    expect(later.rows.find((r) => r.parcel_id === parcelA)!.exception).toBeNull();
  });

  it("no tax for a year before the land was registered", async () => {
    const old = await preview(2020);
    expect(old.preview.exceptions.not_registered_yet).toBeGreaterThanOrEqual(1);
    expect(old.preview.count).toBe(0);
  });

  it("land split from a parcel billed that year is not charged again for that year (0142)", async () => {
    await db.query(`update public.parcels set property_type = 'villa', plot_width_m = 10, plot_length_m = 10 where id = $1`, [parcelB]);
    await db.query(`insert into public.parcel_history (parcel_id, action, data) values ($1, 'created_from', $2)`, [parcelB, JSON.stringify({ source_parcel: parcelA })]);
    const run = await preview(2032);
    const bills = await asUser(db, biller, (tx) => tx.query<{ parcel_id: string; exception: string | null }>(`select * from public.billing_run_batch_bills($1, $2)`, [run.id, nbhd]));
    expect(bills.rows.find((r) => r.parcel_id === parcelB)!.exception).toBe("already_invoiced");
  });
});
