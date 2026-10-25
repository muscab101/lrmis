import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let clerk: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  admin = await bootstrapSuperAdmin(db);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await db.query(`insert into public.parties (full_name, phone, district_id) values ('Owner A', '+252611000001', $1)`, [hodan]);
});

describe("dashboard_period (0110)", () => {
  it("gives this period and the one before, with a day-by-day series", async () => {
    const d = await asUser(db, admin, (tx) => scalar<Record<string, unknown>>(tx, `select public.dashboard_period(30)`));
    expect(d.days).toBe(30);
    expect((d.series as unknown[]).length).toBe(30);
    expect((d.weekday as unknown[]).length).toBe(7);
    expect(d.owners).toMatchObject({ cur: 1, prev: 0, total: 1 });
    expect(d.collected).toMatchObject({ cur: 0, prev: 0 });
  });

  it("clamps the period and leaves out what the caller can't see", async () => {
    const d = await asUser(db, clerk, (tx) => scalar<Record<string, unknown>>(tx, `select public.dashboard_period(2)`));
    expect(d.days).toBe(7);
    expect(d.collected).toBeUndefined();
  });
});
