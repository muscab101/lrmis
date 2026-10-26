import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let officer: string;
let finance: string;
let finance2: string;
let accountant: string;
let hodan: string;
let pos: string;
let parcel: string;

const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

async function expectError(promise: Promise<unknown>, pattern: string) {
  await expect(promise).rejects.toThrow(new RegExp(pattern));
}
const q = <T>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, (tx) => scalar<T>(tx, sql, params));
const run = (user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, (tx) => tx.query(sql, params));
const balance = async (account: string) =>
  Number(
    await scalar<string>(
      db,
      `select coalesce(sum(debit - credit), 0) from public.journal_lines where account = $1`,
      [account],
    ),
  );
const balanced = async () => {
  const r = await scalar<{ dr: string; cr: string }>(
    db,
    `select json_build_object('dr', coalesce(sum(debit), 0), 'cr', coalesce(sum(credit), 0)) from public.journal_lines`,
  );
  return Number(r.dr) === Number(r.cr);
};

async function openShift() {
  return q<string>(cashier, `select public.shift_open($1, 0)`, [pos]);
}
async function take(
  shift: string,
  amount: number,
  method = "cash",
  wallet?: string,
  reference?: string,
) {
  const r = await q<{ payment_id: string }>(cashier, `select public.cashier_take_payment($1, $2)`, [
    shift,
    JSON.stringify({
      parcel_id: parcel,
      amount,
      method,
      wallet,
      reference,
      confirm_duplicate: true,
    }),
  ]);
  return r.payment_id;
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(
    db,
    `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`,
  );
  hodan = await scalar<string>(
    db,
    `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`,
    [region],
  );
  const section = await scalar<string>(
    db,
    `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`,
    [hodan],
  );
  const sector = await scalar<string>(
    db,
    `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`,
    [section],
  );
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  officer = await createStaff(db, admin, "officer@gmail.com", ["collections_officer"], "all");
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  finance2 = await createStaff(db, admin, "finance2@gmail.com", ["finance_manager"], "all");
  accountant = await createStaff(db, admin, "accountant@gmail.com", ["accountant"], "all");
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, developed, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', false, 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3003, 2.04, 0.0001))],
  );
  pos = await scalar<string>(
    db,
    `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`,
    [hodan],
  );
});

describe("cash handovers", () => {
  it("the cashier hands the counted cash to a receiver, who confirms what came; a difference stays on record", async () => {
    const shift = await openShift();
    await take(shift, 100);
    // Not while the shift is open.
    await expectError(
      q(cashier, `select public.handover_create($1, $2)`, [shift, officer]),
      "shift_open",
    );
    await run(cashier, `select public.shift_close($1, 100)`, [shift]);

    const receivers = await asUser(db, cashier, (tx) =>
      tx.query<{ user_id: string }>(`select * from public.handover_receivers($1)`, [shift]),
    );
    expect(receivers.rows.map((r) => r.user_id)).toEqual(
      expect.arrayContaining([officer, finance, accountant]),
    );
    await expectError(
      q(cashier, `select public.handover_create($1, $2)`, [shift, cashier]),
      "receiver",
    );

    const h = await q<string>(cashier, `select public.handover_create($1, $2)`, [shift, officer]);
    expect(
      Number(
        await scalar<string>(db, `select amount from public.cash_handovers where id = $1`, [h]),
      ),
    ).toBe(100);
    await expectError(
      q(cashier, `select public.handover_create($1, $2)`, [shift, finance]),
      "handover_exists",
    );
    // Only the named receiver confirms; a short amount needs a note.
    await expectError(run(finance, `select public.handover_receive($1, 100)`, [h]), "NOT_FOUND");
    await expectError(run(officer, `select public.handover_receive($1, 95)`, [h]), "note_required");
    await run(officer, `select public.handover_receive($1, 95, 'One 5-dollar note missing')`, [h]);
    const r = await scalar<{ status: string; difference: string }>(
      db,
      `select row_to_json(h) from public.cash_handovers h where id = $1`,
      [h],
    );
    expect(r.status).toBe("disputed");
    expect(Number(r.difference)).toBe(-5);
  });
});

describe("statement reconciliation", () => {
  let evc1: string;
  let evc2: string;
  let batch: string;

  it("matches by reference; a statement entry with a mistyped reference is matched by hand; every difference must be explained", async () => {
    const shift = await openShift();
    evc1 = await take(shift, 50, "mobile_money", "evc_plus", "EVC1");
    evc2 = await take(shift, 30, "mobile_money", "evc_plus", "EVC2-TYPO");
    const res = await q<{ id: string }>(
      officer,
      `select public.reconciliation_run('evc_plus', $1, $2, $3)`,
      [
        monthAgo,
        today,
        JSON.stringify([
          { provider_ref: "EVC1", amount: 50, date: today },
          { provider_ref: "EVC2", amount: 30, date: today },
          { provider_ref: "EVC3", amount: 20, date: today },
        ]),
      ],
    );
    batch = res.id;
    const lines = async () =>
      (
        await db.query<{
          id: string;
          provider_ref: string;
          status: string;
          payment_id: string | null;
        }>(
          `select id::text, provider_ref, status::text, payment_id from public.reconciliation_lines where batch_id = $1 order by provider_ref`,
          [batch],
        )
      ).rows;
    const l0 = await lines();
    expect(l0.map((l) => [l.provider_ref, l.status])).toEqual([
      ["EVC1", "matched"],
      ["EVC2", "missing_in_system"],
      ["EVC2-TYPO", "missing_in_provider"],
      ["EVC3", "missing_in_system"],
    ]);

    const evc2Line = l0.find((l) => l.provider_ref === "EVC2")!.id;
    const cands = await asUser(db, officer, (tx) =>
      tx.query<{ payment_id: string }>(`select * from public.recon_candidates($1)`, [evc2Line]),
    );
    expect(cands.rows.map((c) => c.payment_id)).toContain(evc2);
    await expectError(
      run(officer, `select public.recon_line_match($1, $2, '')`, [evc2Line, evc2]),
      "note_required",
    );
    await run(
      officer,
      `select public.recon_line_match($1, $2, 'Cashier typed the reference wrong')`,
      [evc2Line, evc2],
    );
    const l1 = await lines();
    expect(l1.map((l) => [l.provider_ref, l.status])).toEqual([
      ["EVC1", "matched"],
      ["EVC2", "matched"],
      ["EVC3", "missing_in_system"],
    ]);

    await expectError(
      run(officer, `select public.recon_batch_submit($1)`, [batch]),
      "unresolved:1",
    );
    await run(
      officer,
      `select public.recon_line_resolve($1, 'Payer sent it twice; refund requested from Hormuud')`,
      [l1.find((l) => l.provider_ref === "EVC3")!.id],
    );
    await run(officer, `select public.recon_batch_submit($1)`, [batch]);

    const ch = await asUser(db, officer, (tx) =>
      tx.query<{
        channel: string;
        recorded: string;
        statement_total: string;
        missing_in_system_n: string;
        missing_in_system: string;
      }>(`select * from public.collections_channels($1, $2)`, [monthAgo, today]),
    );
    const evc = ch.rows.find((r) => r.channel === "evc_plus")!;
    expect(Number(evc.recorded)).toBe(80);
    expect(Number(evc.statement_total)).toBe(100);
    expect(Number(evc.missing_in_system_n)).toBe(1);
    expect(Number(evc.missing_in_system)).toBe(20);
  });

  it("a second person approves: matched payments become Reconciled and the batch is locked", async () => {
    // The officer can't approve at all; a rejection needs a note and sends it back.
    await expect(
      run(officer, `select public.recon_batch_decide($1, true)`, [batch]),
    ).rejects.toThrow();
    await expectError(
      run(finance, `select public.recon_batch_decide($1, false, '')`, [batch]),
      "note_required",
    );
    await run(
      finance,
      `select public.recon_batch_decide($1, false, 'Attach the Hormuud statement page')`,
      [batch],
    );
    expect(
      await scalar<string>(db, `select status from public.reconciliation_batches where id = $1`, [
        batch,
      ]),
    ).toBe("rejected");
    await run(officer, `select public.recon_batch_submit($1, 'Statement page attached')`, [batch]);
    await run(finance, `select public.recon_batch_decide($1, true)`, [batch]);

    const st = await db.query<{ verify_status: string }>(
      `select verify_status from public.payments where id in ($1, $2)`,
      [evc1, evc2],
    );
    expect(st.rows.every((r) => r.verify_status === "reconciled")).toBe(true);
    const line = await scalar<string>(
      db,
      `select id::text from public.reconciliation_lines where batch_id = $1 limit 1`,
      [batch],
    );
    await expectError(
      run(officer, `select public.recon_line_resolve($1, 'Changing my mind')`, [line]),
      "batch_locked",
    );
    await expectError(
      run(officer, `select public.recon_batch_delete($1)`, [batch]),
      "batch_locked",
    );
  });
});

describe("commission and revenue sharing", () => {
  let rule: string;
  let big: string;

  it("a rule counts only once someone else approves it, then accrues on past and new eligible payments", async () => {
    rule = await q<string>(accountant, `select public.commission_rule_save(null, $1)`, [
      JSON.stringify({
        code: "evc_fee",
        name: "EVC Plus merchant fee",
        kind: "fee",
        party: "Hormuud",
        method: "mobile_money",
        wallet: "evc_plus",
        pct: 1,
        effective_from: monthAgo,
      }),
    ]);
    expect(await balance("2200")).toBe(0);
    await expectError(
      q(accountant, `select public.commission_rule_approve($1)`, [rule]),
      "PERMISSION|MAKER",
    );
    const accrued = await q<number>(finance, `select public.commission_rule_approve($1)`, [rule]);
    expect(accrued).toBe(2); // EVC1 50 and EVC2 30, not the cash payments
    expect(await balance("2200")).toBe(-0.8);
    // An approved rule can't be changed in place.
    await expectError(
      q(accountant, `select public.commission_rule_save($1, $2)`, [
        rule,
        JSON.stringify({ name: "Changed", party: "Hormuud", pct: 2, effective_from: monthAgo }),
      ]),
      "rule_locked",
    );

    // The shift from the statement test is still open.
    const s = await scalar<string>(
      db,
      `select id from public.cashier_shifts where status = 'open' limit 1`,
    );
    big = await take(s, 100, "mobile_money", "evc_plus", "EVC100");
    expect(await balance("2200")).toBe(-1.8);
    expect(await balanced()).toBe(true);
  });

  it("a reversed payment reverses its commission; a payout settles the rest after a second approval", async () => {
    const rev = await q<string>(
      finance,
      `select public.reversal_request($1, 'Paid the wrong parcel')`,
      [big],
    );
    await run(finance2, `select public.reversal_decide($1, true, 'ok')`, [rev]);
    expect(
      await scalar<string>(
        db,
        `select status from public.commission_entries where payment_id = $1`,
        [big],
      ),
    ).toBe("reversed");
    expect(await balance("2200")).toBe(-0.8);

    const sum = await asUser(db, accountant, (tx) =>
      tx.query<{ party: string; accrued: string; reversed: string; payable: string }>(
        `select * from public.commission_summary($1, $2)`,
        [monthAgo, today],
      ),
    );
    expect(sum.rows[0]).toMatchObject({ party: "Hormuud" });
    expect(Number(sum.rows[0]!.accrued)).toBe(1.8);
    expect(Number(sum.rows[0]!.reversed)).toBe(1);
    expect(Number(sum.rows[0]!.payable)).toBe(0.8);

    const payout = await q<string>(
      accountant,
      `select public.commission_payout_create('Hormuud', '2200', $1, '1110')`,
      [today],
    );
    expect(
      Number(
        await scalar<string>(db, `select amount from public.commission_payouts where id = $1`, [
          payout,
        ]),
      ),
    ).toBe(0.8);
    await expect(
      run(accountant, `select public.commission_payout_decide($1, true)`, [payout]),
    ).rejects.toThrow();
    await run(finance, `select public.commission_payout_decide($1, true)`, [payout]);
    expect(await balance("2200")).toBe(0);
    await expectError(
      q(accountant, `select public.commission_payout_create('Hormuud', '2200', $1, '1110')`, [
        today,
      ]),
      "nothing_payable",
    );
    expect(await balanced()).toBe(true);
  });

  it("a new version replaces the old one from its start date", async () => {
    const v2 = await q<string>(accountant, `select public.commission_rule_save(null, $1, $2)`, [
      JSON.stringify({
        name: "EVC Plus merchant fee",
        kind: "fee",
        party: "Hormuud",
        method: "mobile_money",
        wallet: "evc_plus",
        pct: 0.5,
        effective_from: today,
      }),
      rule,
    ]);
    expect(
      await scalar<number>(db, `select version from public.commission_rules where id = $1`, [v2]),
    ).toBe(2);
    await run(finance, `select public.commission_rule_approve($1)`, [v2]);
    const old = await scalar<{ status: string; effective_to: string }>(
      db,
      `select json_build_object('status', status, 'effective_to', effective_to) from public.commission_rules where id = $1`,
      [rule],
    );
    expect(old.status).toBe("retired");
    expect(old.effective_to < today).toBe(true);
    // Today's EVC payments were already charged by version 1: version 2 doesn't charge them again.
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.commission_entries where rule_id = $1`,
        [v2],
      ),
    ).toBe(0);
  });
});

describe("general ledger", () => {
  it("shows the opening balance and a running balance", async () => {
    const gl = await q<{
      opening: string;
      lines: { balance: string; debit: string; credit: string }[];
      debit: string;
      credit: string;
    }>(accountant, `select public.general_ledger('2200', $1, $2)`, [monthAgo, today]);
    expect(Number(gl.opening)).toBe(0);
    expect(gl.lines.length).toBeGreaterThan(0);
    expect(Number(gl.lines.at(-1)!.balance)).toBe(0); // all paid out
    expect(Number(gl.credit)).toBe(Number(gl.debit));
  });
});
