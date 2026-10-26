import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let accountant: string;
let cashier: string;
let hodan: string;
let pos: string;
let parcel: string;

const today = new Date().toISOString().slice(0, 10);
const as = <T>(fn: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<T>) =>
  asUser(db, accountant, fn);
const call = <T>(sql: string, params: unknown[] = []) => as((tx) => scalar<T>(tx, sql, params));

async function expectError(promise: Promise<unknown>, pattern: string) {
  await expect(promise).rejects.toThrow(new RegExp(pattern));
}

/** Account balance (debit side) for a district, or all districts. */
const balance = async (account: string, district: string | null = null) =>
  Number(
    await scalar<string>(db, `select private.account_balance($1, $2, current_date)`, [
      account,
      district,
    ]),
  );

const balanced = async () => {
  const r = await scalar<{ dr: string; cr: string }>(
    db,
    `select json_build_object('dr', coalesce(sum(debit), 0), 'cr', coalesce(sum(credit), 0)) from public.journal_lines`,
  );
  return Number(r.dr) === Number(r.cr);
};

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
  accountant = await createStaff(db, admin, "accountant@gmail.com", ["accountant"], "all");
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
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
  // Hodan collects 300 in cash and 50 by mobile money.
  await db.query(`select private.record_payment($1)`, [
    JSON.stringify({ parcel_id: parcel, amount: 300, method: "cash", pos_id: pos }),
  ]);
  await db.query(`select private.record_payment($1)`, [
    JSON.stringify({
      parcel_id: parcel,
      amount: 50,
      method: "mobile_money",
      wallet: "evc_plus",
      reference: "EVC1",
      pos_id: pos,
    }),
  ]);
});

describe("accounting operations", () => {
  it("a bank deposit waits for confirmation, then moves the district's cash to the bank; it can't take more than the district holds", async () => {
    expect(await balance("1100", hodan)).toBe(300);
    const dep = await call<string>(`select public.movement_save(null, $1)`, [
      JSON.stringify({
        kind: "deposit",
        district_id: hodan,
        date: today,
        from_account: "1100",
        to_account: "1130",
        amount: 200,
        party: "Salaam Bank",
        reference: "SLIP-1",
      }),
    ]);
    // Pending: nothing in the books yet.
    expect(await balance("1130")).toBe(0);
    expect(
      await scalar<string>(db, `select number from public.money_movements where id = $1`, [dep]),
    ).toMatch(/^DEP-\d{4}-000001$/);

    await as((tx) => tx.query(`select public.movement_decide($1, true)`, [dep]));
    expect(await balance("1100", hodan)).toBe(100);
    expect(await balance("1130", hodan)).toBe(200);

    const rows = await as((tx) =>
      tx.query<{
        code: string;
        collected: string;
        cash: string;
        mobile: string;
        deposited: string;
        held: string;
      }>(`select * from public.accounting_districts(current_date - 30, current_date)`),
    );
    const h = rows.rows.find((r) => r.code === "HDN")!;
    expect(Number(h.collected)).toBe(350);
    expect(Number(h.cash)).toBe(300);
    expect(Number(h.mobile)).toBe(50);
    expect(Number(h.deposited)).toBe(200);
    expect(Number(h.held)).toBe(150); // 100 cash + 50 mobile money
    expect(Object.fromEntries(Object.entries(h.held_accounts).map(([k, v]) => [k, Number(v)]))).toEqual({ "1100": 100, "1110": 50 });

    // Too much: Hodan holds only 100 in cash.
    const big = await call<string>(`select public.movement_save(null, $1)`, [
      JSON.stringify({
        kind: "deposit",
        district_id: hodan,
        from_account: "1100",
        to_account: "1130",
        amount: 500,
      }),
    ]);
    await expectError(
      as((tx) => tx.query(`select public.movement_decide($1, true)`, [big])),
      "insufficient",
    );
    // Edit it down while pending, then delete it.
    await as((tx) =>
      tx.query(`select public.movement_save($1, $2)`, [
        big,
        JSON.stringify({
          district_id: hodan,
          from_account: "1100",
          to_account: "1130",
          amount: 50,
        }),
      ]),
    );
    expect(
      Number(
        await scalar<string>(db, `select amount from public.money_movements where id = $1`, [big]),
      ),
    ).toBe(50);
    await as((tx) => tx.query(`select public.movement_delete($1)`, [big]));
    expect(
      await scalar<number>(db, `select count(*)::int from public.money_movements where id = $1`, [
        big,
      ]),
    ).toBe(0);

    // A deposit must go into a bank and come from a district.
    await expectError(
      call(`select public.movement_save(null, $1)`, [
        JSON.stringify({
          kind: "deposit",
          district_id: hodan,
          from_account: "1100",
          to_account: "1110",
          amount: 5,
        }),
      ]),
      "to_account",
    );
    await expectError(
      call(`select public.movement_save(null, $1)`, [
        JSON.stringify({ kind: "deposit", from_account: "1100", to_account: "1130", amount: 5 }),
      ]),
      "district_id",
    );

    // A confirmed deposit is cancelled with a reversing entry and can't be deleted.
    await expectError(
      as((tx) => tx.query(`select public.movement_delete($1)`, [dep])),
      "status",
    );
    await as((tx) =>
      tx.query(`select public.movement_cancel($1, 'Slip was for another office')`, [dep]),
    );
    expect(await balance("1100", hodan)).toBe(300);
    expect(await balance("1130")).toBe(0);
    expect(await balanced()).toBe(true);
  });

  it("money out is confirmed or rejected; other money in; the overview adds it up", async () => {
    await call(`select public.movement_save(null, $1)`, [
      JSON.stringify({
        kind: "income",
        to_account: "1130",
        account: "4500",
        amount: 1000,
        party: "Grant",
      }),
    ]).then((id) => as((tx) => tx.query(`select public.movement_decide($1, true)`, [id])));
    const exp = await call<string>(`select public.movement_save(null, $1)`, [
      JSON.stringify({
        kind: "expense",
        account: "5220",
        from_account: "1130",
        amount: 120,
        party: "Stationery shop",
      }),
    ]);
    await expectError(
      as((tx) => tx.query(`select public.movement_decide($1, false, '')`, [exp])),
      "note_required",
    );
    await as((tx) => tx.query(`select public.movement_decide($1, true)`, [exp]));
    const rejected = await call<string>(`select public.movement_save(null, $1)`, [
      JSON.stringify({
        kind: "expense",
        account: "5230",
        from_account: "1100",
        district_id: hodan,
        amount: 40,
      }),
    ]);
    await as((tx) =>
      tx.query(`select public.movement_decide($1, false, 'No receipt')`, [rejected]),
    );
    // Expenses can't be booked to the system's own accounts, and income can't pretend to be a tax payment.
    await expectError(
      call(`select public.movement_save(null, $1)`, [
        JSON.stringify({ kind: "expense", account: "5300", from_account: "1130", amount: 1 }),
      ]),
      "account",
    );
    await expectError(
      call(`select public.movement_save(null, $1)`, [
        JSON.stringify({ kind: "income", account: "4100", to_account: "1130", amount: 1 }),
      ]),
      "account",
    );

    const o = await call<{
      collected: string;
      other_in: string;
      money_out: string;
      pending: Record<string, unknown>;
      balances: { code: string; balance: string }[];
    }>(`select public.accounting_overview(current_date - 30, current_date)`);
    expect(Number(o.collected)).toBe(350);
    expect(Number(o.other_in)).toBe(1000);
    expect(Number(o.money_out)).toBe(120);
    expect(Number(o.balances.find((b) => b.code === "1130")!.balance)).toBe(880);
    expect(await balanced()).toBe(true);
  });

  it("assets: bought, depreciated once a month, refused cost changes after that, sold with the loss booked", async () => {
    const id = await call<string>(`select public.asset_save(null, $1)`, [
      JSON.stringify({
        name: "Toyota Hilux",
        category: "vehicle",
        district_id: hodan,
        acquired_on: today,
        cost: 1200,
        useful_life_months: 12,
        funded_from: "1130",
      }),
    ]);
    expect(await balance("1500")).toBe(1200);
    const now = new Date();
    const run = await call<{ count: number; total: string }>(
      `select public.asset_depreciate($1, $2)`,
      [now.getFullYear(), now.getMonth() + 1],
    );
    expect(run.count).toBe(1);
    expect(Number(run.total)).toBe(100);
    expect(
      (
        await call<{ count: number }>(`select public.asset_depreciate($1, $2)`, [
          now.getFullYear(),
          now.getMonth() + 1,
        ])
      ).count,
    ).toBe(0);
    expect(
      Number(
        await scalar<string>(db, `select book_value from public.fixed_assets_book where id = $1`, [
          id,
        ]),
      ),
    ).toBe(1100);

    await expectError(
      call(`select public.asset_save($1, $2)`, [
        id,
        JSON.stringify({
          name: "Toyota Hilux",
          category: "vehicle",
          acquired_on: today,
          cost: 1500,
          useful_life_months: 12,
          funded_from: "1130",
        }),
      ]),
      "depreciated",
    );
    await expectError(
      as((tx) => tx.query(`select public.asset_delete($1)`, [id])),
      "depreciated",
    );

    // Sold for 1000: cost 1200 − 100 written off = 1100 book value → loss of 100.
    await as((tx) =>
      tx.query(`select public.asset_dispose($1, $2)`, [
        id,
        JSON.stringify({ date: today, amount: 1000, account: "1130" }),
      ]),
    );
    expect(await balance("1500")).toBe(0);
    expect(await balance("1590")).toBe(0);
    expect(await balance("4400")).toBe(100);

    // Added by mistake: deleted, and its purchase reversed.
    const oops = await call<string>(`select public.asset_save(null, $1)`, [
      JSON.stringify({ name: "Desk", category: "furniture", acquired_on: today, cost: 80 }),
    ]);
    await as((tx) => tx.query(`select public.asset_delete($1)`, [oops]));
    expect(await balance("1500")).toBe(0);
    expect(await balanced()).toBe(true);
  });

  it("chart of accounts: add a bank, system accounts stay on, used accounts are switched off instead of deleted; a manual entry reverses once", async () => {
    await call(`select public.gl_account_save($1)`, [
      JSON.stringify({
        code: "1131",
        name_so: "Bangiga Salaam",
        name_en: "Salaam Bank",
        type: "asset",
        is_bank: true,
      }),
    ]);
    await call(`select public.gl_account_save($1)`, [
      JSON.stringify({ code: "5270", name_so: "Kiro", name_en: "Rent", type: "expense" }),
    ]);
    await expectError(
      call(`select public.gl_account_save($1)`, [
        JSON.stringify({
          code: "5270",
          name_so: "Kiro",
          name_en: "Rent",
          type: "asset",
          is_bank: true,
        }),
      ]),
      "is_bank",
    );
    await expectError(
      call(`select public.gl_account_save($1)`, [
        JSON.stringify({
          code: "1100",
          name_so: "Lacag",
          name_en: "Cash",
          type: "asset",
          active: false,
        }),
      ]),
      "system_account",
    );
    await expectError(call(`select public.gl_account_delete('1200')`), "system_account");

    const je = await call<string>(`select public.journal_manual(current_date, 'Rent paid', $1)`, [
      JSON.stringify([
        { account: "5270", debit: 30 },
        { account: "1131", credit: 30 },
      ]),
    ]);
    expect(await call<string>(`select public.gl_account_delete('5270')`)).toBe("deactivated");
    await call(`select public.gl_account_save($1)`, [
      JSON.stringify({ code: "5280", name_so: "Tijaabo", name_en: "Trial", type: "expense" }),
    ]);
    expect(await call<string>(`select public.gl_account_delete('5280')`)).toBe("deleted");

    await as((tx) => tx.query(`select public.journal_reverse($1, 'Wrong account')`, [je]));
    expect(await balance("1131")).toBe(0);
    await expectError(
      as((tx) => tx.query(`select public.journal_reverse($1, 'Again')`, [je])),
      "already_reversed",
    );
    // Only manual entries can be reversed this way.
    const auto = await scalar<string>(
      db,
      `select id from public.journal_entries where source = 'payment' limit 1`,
    );
    await expectError(
      as((tx) => tx.query(`select public.journal_reverse($1, 'Not this one')`, [auto])),
      "not_manual",
    );
    expect(await balanced()).toBe(true);
  });

  it("a cashier can't record or confirm accounting movements", async () => {
    await expect(
      asUser(db, cashier, (tx) =>
        tx.query(`select public.movement_save(null, $1)`, [
          JSON.stringify({
            kind: "deposit",
            district_id: hodan,
            from_account: "1100",
            to_account: "1130",
            amount: 5,
          }),
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(db, cashier, (tx) =>
        tx.query(`select public.accounting_overview(current_date - 1, current_date)`),
      ),
    ).rejects.toThrow();
  });
});
