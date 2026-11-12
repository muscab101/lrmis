import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let finance: string;
let hodan: string;
let mig: string;

const call = <T>(sql: string, params: unknown[] = []) => asUser(db, admin, (tx) => scalar<T>(tx, sql, params));
const count = (sql: string, params: unknown[] = []) => scalar<number>(db, `select (${sql})::int`, params);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  mig = await call<string>(`select public.acct_migration_create($1)`, [JSON.stringify({ name: "Old ledger 2024", source_kind: "sql", source_backup_ok: true })]);
  await call(`select public.acct_migration_add_table($1, $2)`, [mig, JSON.stringify({ name: "tbl_journal", columns: [{ name: "id", type: "int" }], primary_key: ["id"], row_count: 2 })]);
  await call(`select public.acct_migration_add_rows($1, 'tbl_journal', 1, $2)`, [mig, JSON.stringify([{ id: 1 }, { id: 2 }])]);
  await call(`select public.acct_migration_save($1, $2)`, [mig, JSON.stringify({ district_map: { HODAN: hodan }, options: { lock_months: true } })]);
  // What the app works out from the mapping: one new account, one mapped to ours, two entries (one unbalanced).
  const items = [
    { entity: "account", source_key: "A9", status: "ready", data: { code: "6900", create: true, name_en: "Old sundry costs", type: "expense" } },
    { entity: "account", source_key: "CASH", status: "ready", data: { code: "1100", create: false } },
    { entity: "entry", source_key: "1", status: "ready", data: { date: "2024-03-05", ref: "JV-1", memo: "Office costs",
        lines: [{ account_key: "A9", district_key: "HODAN", debit: 40, credit: 0 }, { account_key: "CASH", district_key: "HODAN", debit: 0, credit: 40 }] } },
    { entity: "entry", source_key: "2", status: "ready", data: { date: "2024-03-06", ref: "JV-2",
        lines: [{ account_key: "A9", debit: 10, credit: 0 }, { account_key: "CASH", debit: 0, credit: 9 }] } },
    { entity: "entry", source_key: "3", status: "error", message: "no date", data: { lines: [] } },
  ];
  await call(`select public.acct_migration_set_items($1, $2, true, $3)`, [mig, JSON.stringify(items), JSON.stringify({ entries: 3 })]);
});

describe("accounting migration center (0213)", () => {
  it("only the Super Admin can see or use it", async () => {
    await expect(asUser(db, finance, (tx) => tx.query(`select public.acct_migration_backup($1)`, [mig]))).rejects.toThrow(/^PERMISSION_DENIED/);
    expect(await asUser(db, finance, (tx) => scalar<number>(tx, `select count(*)::int from public.acct_migrations`))).toBe(0);
  });

  it("the real run needs a backup of the books and a test first", async () => {
    await expect(call(`select public.acct_migration_run($1)`, [mig])).rejects.toThrow(/^CONFLICT: migration_needs_backup/);
    const b = await call<{ ok: boolean; counts: Record<string, number> }>(`select public.acct_migration_backup($1)`, [mig]);
    expect(b.ok).toBe(true);
    expect(Object.keys(b.counts).sort()).toEqual(["fiscal_periods", "gl_accounts", "journal_entries", "journal_lines"]);
    await expect(call(`select public.acct_migration_run($1)`, [mig])).rejects.toThrow(/^CONFLICT: migration_needs_test/);
  });

  it("a test shows what would happen and puts everything back", async () => {
    const before = await count(`select count(*) from public.journal_entries`);
    const r = await call<{ accounts_created: number; accounts_mapped: number; entries: number; failed: number; skipped: number; failures: { key: string }[] }>(
      `select public.acct_migration_test($1)`,
      [mig],
    );
    expect([r.accounts_created, r.accounts_mapped, r.entries, r.failed, r.skipped]).toEqual([1, 1, 1, 1, 1]);
    expect(r.failures.map((f) => f.key)).toEqual(["2"]);
    expect(await count(`select count(*) from public.journal_entries`)).toBe(before);
    expect(await count(`select count(*) from public.gl_accounts where code = '6900'`)).toBe(0);
    expect(await count(`select count(*) from public.fiscal_periods`)).toBe(0);
  });

  it("the run posts entries on their old dates with the old IDs mapped, and locks those months", async () => {
    const r = await call<{ entries: number; failed: number }>(`select public.acct_migration_run($1)`, [mig]);
    expect([r.entries, r.failed]).toEqual([1, 1]);
    const entry = await scalar<string>(db, `select target_id from public.acct_migration_id_map where migration_id = $1 and entity = 'entry' and source_id = '1'`, [mig]);
    expect(await scalar<string>(db, `select source || ' ' || entry_date || ' ' || memo from public.journal_entries where id = $1`, [entry])).toBe(
      "migration 2024-03-05 Migrated JV-1: Office costs",
    );
    expect(await count(`select count(*) from public.journal_lines where entry_id = $1 and district_id = $2`, [entry, hodan])).toBe(2);
    expect(await scalar<string>(db, `select status::text from public.fiscal_periods where year = 2024 and month = 3`)).toBe("locked");
    const rep = await call<{ books_entries: number; books_debit: number; trial: { account: string }[] }>(`select public.acct_migration_report($1)`, [mig]);
    expect([rep.books_entries, Number(rep.books_debit)]).toEqual([1, 40]);
    expect(rep.trial.map((t) => t.account)).toEqual(["1100", "6900"]);
    await expect(call(`select public.acct_migration_save($1, '{}')`, [mig])).rejects.toThrow(/^CONFLICT: migration_done/);
  });

  it("undo takes the run back out: entries, lines, the new account, the months it locked", async () => {
    await expect(call(`select public.acct_migration_undo($1, 'no')`, [mig])).rejects.toThrow(/^VALIDATION: reason/);
    const u = await call<{ entries: number; accounts: number }>(`select public.acct_migration_undo($1, 'Wrong district mapping')`, [mig]);
    expect([u.entries, u.accounts]).toEqual([1, 1]);
    expect(await count(`select count(*) from public.journal_entries where source = 'migration'`)).toBe(0);
    expect(await count(`select count(*) from public.gl_accounts where code = '6900'`)).toBe(0);
    expect(await scalar<string>(db, `select status::text from public.fiscal_periods where year = 2024 and month = 3`)).toBe("open");
  });
});
