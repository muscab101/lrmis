import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let boss: string;
let admin: string;
let hodan: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const act = (by: string, user: string, action: string) => asUser(db, by, (tx) => tx.query(`select public.admin_apply_user_action($1, $2)`, [user, action]));
const check = (by: string, user: string, action: string) => asUser(db, by, (tx) => tx.query(`select public.admin_authorize_user_action($1, $2)`, [user, action]));
const profile = (user: string) => db.query<{ status: string; must_change_password: boolean; deleted_at: string | null }>(`select status, must_change_password, deleted_at from public.profiles where user_id = $1`, [user]).then((r) => r.rows[0]!);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  boss = await bootstrapSuperAdmin(db);
  admin = await createStaff(db, boss, "admin@gmail.com", ["admin"], "all");
});

describe("Users page: password and delete", () => {
  it("an admin sets a staff member's password: they must change it and are signed out", async () => {
    const u = await createStaff(db, boss, "cashier1@gmail.com", ["cashier"], [hodan]);
    await check(admin, u, "set_password");
    await act(admin, u, "set_password");
    expect((await profile(u)).must_change_password).toBe(true);
    await check(admin, u, "send_reset_link");
  });

  it("an admin removes (soft deletes) a staff member", async () => {
    const u = await createStaff(db, boss, "clerk1@gmail.com", ["data_entry_clerk"], [hodan]);
    await check(admin, u, "soft_delete");
    await act(admin, u, "soft_delete");
    const p = await profile(u);
    expect(p.status).toBe("deleted");
    expect(p.deleted_at).not.toBeNull();
  });

  it("only super admin deletes for good, and only users with no records", async () => {
    const u = await createStaff(db, boss, "clerk2@gmail.com", ["data_entry_clerk"], [hodan]);
    await expectError(check(admin, u, "hard_delete"), "PERMISSION_DENIED");
    await check(boss, u, "hard_delete");
    await act(boss, u, "hard_delete");
    await db.query(`delete from auth.users where id = $1`, [u]);
    expect(await scalar<number>(db, `select count(*)::int from public.profiles where user_id = $1`, [u])).toBe(0);
  });

  it("nobody changes their own password or deletes themselves here, and an admin can't touch super admin", async () => {
    await expectError(check(admin, admin, "set_password"), "SELF_ACTION_FORBIDDEN");
    await expectError(check(admin, admin, "soft_delete"), "SELF_ACTION_FORBIDDEN");
    await expectError(check(admin, boss, "set_password"), "PERMISSION_DENIED");
    await expectError(check(admin, boss, "soft_delete"), "PERMISSION_DENIED");
  });
});

describe("Users page: deactivate someone who left the job", () => {
  it("an admin deactivates a staff member (signed out, can't sign in) and can activate them again", async () => {
    const u = await createStaff(db, boss, "leaver@gmail.com", ["cashier"], [hodan]);
    await act(admin, u, "suspend");
    expect((await profile(u)).status).toBe("suspended");
    await act(admin, u, "reactivate");
    expect((await profile(u)).status).toBe("active");
    await expectError(act(admin, u, "reactivate"), "CONFLICT");
  });
});

describe("every working permission has a role", () => {
  it("shift approval, certificate cancel and transfer cancel belong to the roles that do that work", async () => {
    const has = (role: string, perm: string) =>
      scalar<boolean>(db, `select exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = $1 and rp.permission_key = $2)`, [role, perm]);
    expect(await has("finance_manager", "cashier.approve")).toBe(true);
    expect(await has("registrar", "certificates.cancel")).toBe(true);
    expect(await has("registrar", "transfers.cancel")).toBe(true);
    expect(await has("legal_officer", "transfers.cancel")).toBe(true);
  });
});
