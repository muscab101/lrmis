import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let clerk: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  clerk = await createStaff(db, admin, "clerk@gmail.com", ["customer_service"], [hodan]);
});

describe("go-live health (Phase 12)", () => {
  it("admins get integrity and queue checks; the ledger is balanced on an empty database", async () => {
    const h = await asUser(db, admin, (tx) => scalar<{ checks: { key: string; state: string }[]; database: { parcels: number } }>(tx, `select public.system_health()`));
    const byKey = Object.fromEntries(h.checks.map((c) => [c.key, c.state]));
    expect(byKey.ledger_balanced).toBe("ok");
    expect(byKey.debtors_match).toBe("ok");
    expect(byKey.messages_failed).toBe("ok");
    expect(h.checks.length).toBeGreaterThanOrEqual(10);
    expect(h.database.parcels).toBe(0);
  });

  it("other staff can't read it", async () => {
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.system_health()`))).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});

describe("legacy import (Phase 12)", () => {
  const row = { legacy_ref: "OLD-HDN-0001", full_name: "  Faadumo  Cali Nuur ", phone: "0615550123", id_number: "SO-123 456", district_code: "hdn", plot_no: "12", old_deed_no: "D-77" };

  it("dry run validates without writing; bad rows list their problems", async () => {
    const svc = (p: unknown, dry: boolean) => as(db, "service_role", {}, (tx) => scalar<{ status: string; problems?: string[]; number?: string }>(tx, `select public.legacy_import_row($1, $2, 'batch-1', $3)`, [JSON.stringify(p), admin, dry]));
    expect((await svc(row, true)).status).toBe("would_create");
    expect(await scalar<number>(db, `select count(*)::int from public.applications`)).toBe(0);
    const bad = await svc({ legacy_ref: "OLD-2", full_name: "X", phone: "12", district_code: "ZZZ", gender: "m" }, true);
    expect(bad.status).toBe("invalid");
    expect(bad.problems).toEqual(expect.arrayContaining(["full_name", "phone", "district_code", "gender"]));
  });

  it("commit creates a draft office application with the owner; re-running is a no-op", async () => {
    const svc = (dry: boolean) => as(db, "service_role", {}, (tx) => scalar<{ status: string; number?: string }>(tx, `select public.legacy_import_row($1, $2, 'batch-1', $3)`, [JSON.stringify(row), admin, dry]));
    const first = await svc(false);
    expect(first.status).toBe("created");
    const app = await scalar<{ channel: string; status: string; old_deed_no: string }>(db, `select row_to_json(a) from public.applications a where legacy_ref = 'OLD-HDN-0001'`);
    expect(app.channel).toBe("office");
    expect(app.status).toBe("draft");
    expect(await scalar<string>(db, `select phone from public.parties where legacy_id = 'OLD-HDN-0001'`)).toBe("+252615550123");
    const again = await svc(false);
    expect(again).toEqual({ status: "exists", number: first.number });
    await expect(asUser(db, admin, (tx) => tx.query(`select public.legacy_import_row('{}', $1, 'x', true)`, [admin]))).rejects.toThrow(/permission denied/);
  });
});
