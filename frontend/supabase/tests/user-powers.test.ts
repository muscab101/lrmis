import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let auditor: string;

const can = (user: string, key: string) => asUser(db, user, (tx) => scalar<boolean>(tx, `select public.has_permission($1)`, [key]));
const mine = (user: string) => asUser(db, user, (tx) => scalar<string[]>(tx, `select public.my_permissions()`));
const set = (who: string, user: string, allow: string[], deny: string[]) =>
  asUser(db, who, (tx) => scalar<string[]>(tx, `select public.user_permissions_set($1, $2, $3)`, [user, allow, deny]));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  auditor = await createStaff(db, admin, "auditor@gmail.com", ["auditor"], [hodan]);
});

describe("powers per user (0209)", () => {
  it("the Super Admin gives one user an extra power and takes one of the role's away; the role stays as it is", async () => {
    expect(await can(cashier, "surveys.view")).toBe(false);
    expect(await can(cashier, "cashier.view")).toBe(true);
    const now = await set(admin, cashier, ["surveys.view"], ["cashier.view"]);
    expect(now).toContain("surveys.view");
    expect(now).not.toContain("cashier.view");
    expect(await can(cashier, "surveys.view")).toBe(true);
    expect(await can(cashier, "cashier.view")).toBe(false);
    expect(await mine(cashier)).toContain("surveys.view");
    expect(await scalar<boolean>(db, `select private.user_has_permission($1, 'surveys.view')`, [cashier])).toBe(true);
    // Another cashier with the same role is unchanged.
    const other = await createStaff(db, admin, "cashier2@gmail.com", ["cashier"], "all");
    expect(await can(other, "surveys.view")).toBe(false);
    expect(await can(other, "cashier.view")).toBe(true);
  });

  it("setting again replaces what was set; empty lists go back to the role", async () => {
    await set(admin, cashier, [], []);
    expect(await can(cashier, "surveys.view")).toBe(false);
    expect(await can(cashier, "cashier.view")).toBe(true);
    expect(await scalar<number>(db, `select count(*)::int from public.user_permission_overrides where user_id = $1`, [cashier])).toBe(0);
  });

  it("only the Super Admin may do it, never on a Super Admin, and only with real powers", async () => {
    await expect(set(auditor, cashier, ["surveys.view"], [])).rejects.toThrow(/^PERMISSION_DENIED/);
    await expect(set(admin, admin, [], ["cashier.view"])).rejects.toThrow(/^CONFLICT: super_admin/);
    await expect(set(admin, cashier, ["made.up"], [])).rejects.toThrow(/^VALIDATION: permission/);
    await expect(set(admin, cashier, ["surveys.view"], ["surveys.view"])).rejects.toThrow(/^VALIDATION: permission/);
  });
});
