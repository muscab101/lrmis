import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, createAuthUser, createDb, roleId, scalar } from "./harness";

// Resolve role ids up front: PGlite has one connection, so querying `db` from inside a
// transaction callback would wait on the transaction forever.
const ROLE: Record<string, string> = {};

let db: PGlite;
let superAdmin: string;
let hodan: string;
let wadajir: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(
    db,
    `insert into public.regions (code, name_so, name_en) values ('BN', 'Banaadir', 'Banadir') returning id`,
  );
  hodan = await scalar<string>(
    db,
    `insert into public.districts (region_id, code, name_so, name_en) values ($1, 'HDN', 'Hodan', 'Hodan') returning id`,
    [region],
  );
  for (const key of ["super_admin", "admin", "auditor", "cashier", "finance_manager"]) {
    ROLE[key] = await roleId(db, key);
  }
  wadajir = await scalar<string>(
    db,
    `insert into public.districts (region_id, code, name_so, name_en) values ($1, 'WDJ', 'Wadajir', 'Wadajir') returning id`,
    [region],
  );
});

describe("catalog", () => {
  it("seeds 25 modules × 8 actions + 9 special permissions", async () => {
    expect(await scalar<number>(db, `select count(*)::int from public.permissions`)).toBe(209);
  });

  it("seeds the 23 default roles with a protected Super Admin", async () => {
    expect(await scalar<number>(db, `select count(*)::int from public.roles where is_system`)).toBe(23);
    const sa = await db.query<{ is_protected: boolean; grants_all: boolean }>(
      `select is_protected, grants_all from public.roles where key = 'super_admin'`,
    );
    expect(sa.rows[0]).toEqual({ is_protected: true, grants_all: true });
  });
});

describe("bootstrap", () => {
  it("is not complete before setup and anonymous visitors can ask", async () => {
    const status = await as(db, "anon", {}, (tx) => scalar<{ complete: boolean }>(tx, `select public.setup_status()`));
    expect(status.complete).toBe(false);
  });

  it("staff auth users start as invited with no roles", async () => {
    superAdmin = await createAuthUser(db, { email: "boss@gmail.com", kind: "staff", fullName: "Boss" });
    const p = await db.query<{ kind: string; status: string }>(
      `select kind, status from public.profiles where user_id = $1`,
      [superAdmin],
    );
    expect(p.rows[0]).toEqual({ kind: "staff", status: "invited" });
    expect(await scalar<number>(db, `select count(*)::int from public.user_roles where user_id = $1`, [superAdmin])).toBe(0);
  });

  it("only the service role can bootstrap, and only once", async () => {
    await expect(
      asUser(db, superAdmin, (tx) => tx.query(`select public.setup_bootstrap_super_admin($1, 'Boss')`, [superAdmin])),
    ).rejects.toThrow(/permission denied/);

    await asService(db, (tx) => tx.query(`select public.setup_bootstrap_super_admin($1, 'Boss')`, [superAdmin]));
    const p = await db.query<{ status: string; must_change_password: boolean }>(
      `select status, must_change_password from public.profiles where user_id = $1`,
      [superAdmin],
    );
    expect(p.rows[0]).toEqual({ status: "active", must_change_password: true });

    const other = await createAuthUser(db, { email: "intruder@gmail.com", kind: "staff" });
    await expectError(
      asService(db, (tx) => tx.query(`select public.setup_bootstrap_super_admin($1, 'X')`, [other])),
      "SETUP_ALREADY_DONE",
    );
  });

  it("Super Admin needs 2FA (aal2) before any permission works", async () => {
    expect(await asUser(db, superAdmin, (tx) => scalar(tx, `select public.has_permission('users.create')`), "aal1")).toBe(false);
    expect(await asUser(db, superAdmin, (tx) => scalar(tx, `select public.has_permission('users.create')`))).toBe(true);
    await expectError(
      asUser(db, superAdmin, (tx) => tx.query(`select public.admin_delete_role(gen_random_uuid())`), "aal1"),
      "MFA_REQUIRED",
    );
  });
});

describe("admin golden path (§10 step 11, database side)", () => {
  let fieldCollectorRole: string;
  let collector: string;

  it("creates the Field Collector role with only payments.create + parcels.view", async () => {
    fieldCollectorRole = await asUser(db, superAdmin, (tx) =>
      scalar<string>(
        tx,
        `select public.admin_create_role('Ururiye Goob', 'Field Collector', '', '#16A34A', 'district', '{}',
                                         array['payments.create', 'parcels.view'])`,
      ),
    );
    const perms = await db.query<{ permission_key: string }>(
      `select permission_key from public.role_permissions where role_id = $1 order by 1`,
      [fieldCollectorRole],
    );
    expect(perms.rows.map((r) => r.permission_key)).toEqual(["parcels.view", "payments.create"]);
  });

  it("rejects a duplicate role name", async () => {
    await expectError(
      asUser(db, superAdmin, (tx) =>
        tx.query(`select public.admin_create_role('x', 'field collector', '', '#16A34A', 'own', '{}', '{}')`),
      ),
      "CONFLICT",
    );
  });

  it("creates collector.test@gmail.com scoped to Hodan", async () => {
    collector = await createAuthUser(db, { email: "collector.test@gmail.com", kind: "staff" });
    await asUser(db, superAdmin, (tx) =>
      tx.query(`select public.admin_provision_user($1, 'Test Collector', '+252611234567', array[$2::uuid], false, array[$3::uuid], false)`, [
        collector,
        fieldCollectorRole,
        hodan,
      ]),
    );
    const p = await db.query<{ status: string; must_change_password: boolean; created_by: string }>(
      `select status, must_change_password, created_by from public.profiles where user_id = $1`,
      [collector],
    );
    expect(p.rows[0]).toEqual({ status: "active", must_change_password: true, created_by: superAdmin });
  });

  it("the collector has only the role's permissions and only sees Hodan", async () => {
    const result = await asUser(db, collector, async (tx) => ({
      pay: await scalar(tx, `select public.has_permission('payments.create')`),
      users: await scalar(tx, `select public.has_permission('users.view')`),
      districts: await scalar<string[]>(tx, `select public.user_district_ids()`),
      hodan: await scalar(tx, `select public.can_access_district($1)`, [hodan]),
      wadajir: await scalar(tx, `select public.can_access_district($1)`, [wadajir]),
      profilesVisible: await scalar<number>(tx, `select count(*)::int from public.profiles`),
    }));
    expect(result).toEqual({
      pay: true,
      users: false,
      districts: [hodan],
      hodan: true,
      wadajir: false,
      profilesVisible: 1,
    });
  });

  it("the collector cannot call admin RPCs or write RBAC tables", async () => {
    await expectError(
      asUser(db, collector, (tx) =>
        tx.query(`select public.admin_create_role('a', 'b', '', '#000000', 'own', '{}', '{}')`),
      ),
      "PERMISSION_DENIED",
    );
    await expect(
      asUser(db, collector, (tx) =>
        tx.query(`insert into public.user_roles (user_id, role_id) values ($1, $2)`, [collector, fieldCollectorRole]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("suspending blocks access immediately", async () => {
    await asUser(db, superAdmin, (tx) => tx.query(`select public.admin_apply_user_action($1, 'suspend')`, [collector]));
    expect(await asUser(db, collector, (tx) => scalar(tx, `select public.has_permission('parcels.view')`))).toBe(false);
  });

  it("cannot delete a role that still has users, can after moving them", async () => {
    await expectError(
      asUser(db, superAdmin, (tx) => tx.query(`select public.admin_delete_role($1)`, [fieldCollectorRole])),
      "ROLE_IN_USE: 1",
    );
    const cashier = ROLE.cashier!;
    await asUser(db, superAdmin, (tx) => tx.query(`select public.admin_move_role_users($1, $2)`, [fieldCollectorRole, cashier]));
    await asUser(db, superAdmin, (tx) => tx.query(`select public.admin_delete_role($1)`, [fieldCollectorRole]));
    expect(await scalar<number>(db, `select count(*)::int from public.roles where id = $1`, [fieldCollectorRole])).toBe(0);
  });

  it("system and protected roles cannot be deleted", async () => {
    await expectError(
      asUser(db, superAdmin, (tx) => tx.query(`select public.admin_delete_role($1)`, [ROLE.super_admin])),
      "PROTECTED_ROLE",
    );
    await expectError(
      asUser(db, superAdmin, (tx) => tx.query(`select public.admin_delete_role($1)`, [ROLE.auditor])),
      "SYSTEM_ROLE",
    );
  });

  it("the Super Admin cannot delete, suspend or demote themselves", async () => {
    await expectError(
      asUser(db, superAdmin, (tx) => tx.query(`select public.admin_apply_user_action($1, 'soft_delete')`, [superAdmin])),
      "SELF_ACTION_FORBIDDEN",
    );
    await expectError(
      asUser(db, superAdmin, (tx) =>
        tx.query(`select public.admin_update_user($1, 'Boss', null, array[$2::uuid], true, '{}')`, [
          superAdmin,
          fieldCollectorRole,
        ]),
      ),
      "SELF_ACTION_FORBIDDEN",
    );
  });

  it("the last active Super Admin can never be removed, even by the database owner", async () => {
    await expectError(
      db.transaction((tx) => tx.query(`delete from public.user_roles where user_id = $1`, [superAdmin])),
      "LAST_SUPER_ADMIN",
    );
    await expectError(
      db.transaction((tx) => tx.query(`update public.profiles set status = 'suspended' where user_id = $1`, [superAdmin])),
      "LAST_SUPER_ADMIN",
    );
  });

  it("writes every step to the audit log with the actor and IP", async () => {
    const rows = await db.query<{ action: string; actor_id: string; ip: string }>(
      `select action, actor_id, ip from public.audit_log where action like 'user.%' or action like 'role.%' order by id`,
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["role.create", "user.create", "user.suspend", "role.move_users", "role.delete"]),
    );
    expect(rows.rows.every((r) => r.actor_id === superAdmin && r.ip === "203.0.113.7")).toBe(true);
    await expect(db.query(`update public.audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
  });
});

describe("privilege escalation", () => {
  let admin: string;

  beforeAll(async () => {
    admin = await createAuthUser(db, { email: "admin@gmail.com", kind: "staff" });
    await asUser(db, superAdmin, (tx) =>
      tx.query(`select public.admin_provision_user($1, 'Admin', null, array[$2::uuid], true, '{}', false)`, [
        admin,
        ROLE.admin,
      ]),
    );
  });

  it("an Admin cannot grant a permission they do not hold", async () => {
    await expectError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.admin_create_role('r', 'Refunder', '', '#000000', 'own', '{}', array['payments.refund'])`),
      ),
      "PRIVILEGE_ESCALATION: payments.refund",
    );
  });

  it("an Admin cannot assign the Super Admin role or a role with permissions they lack", async () => {
    const victim = await createAuthUser(db, { email: "victim@gmail.com", kind: "staff" });
    await expectError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.admin_provision_user($1, 'V', null, array[$2::uuid], true, '{}', false)`, [
          victim,
          ROLE.super_admin,
        ]),
      ),
      "PRIVILEGE_ESCALATION",
    );
    await expectError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.admin_provision_user($1, 'V', null, array[$2::uuid], true, '{}', false)`, [
          victim,
          ROLE.finance_manager,
        ]),
      ),
      "PRIVILEGE_ESCALATION",
    );
  });

  it("an Admin cannot manage a Super Admin", async () => {
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.admin_apply_user_action($1, 'suspend')`, [superAdmin])),
      "PERMISSION_DENIED: super_admin",
    );
  });

  it("an Admin cannot edit a role they hold", async () => {
    await expectError(
      asUser(db, admin, (tx) =>
        tx.query(
          `select public.admin_update_role($1, 'Maamule', 'Admin', '', '#1E4FA3', 'all', '{}', array['users.view'])`,
          [ROLE.admin],
        ),
      ),
      "SELF_ACTION_FORBIDDEN",
    );
  });
});

describe("citizens", () => {
  it("phone sign-ups become citizens with own-scope permissions and no 2FA requirement", async () => {
    const citizen = await createAuthUser(db, { phone: "+252615550000" });
    const r = await asUser(
      db,
      citizen,
      async (tx) => ({
        kind: await scalar(tx, `select kind from public.profiles where user_id = auth.uid()`),
        apply: await scalar(tx, `select public.has_permission('applications.create')`),
        admin: await scalar(tx, `select public.has_permission('users.view')`),
        districts: await scalar<string[]>(tx, `select public.user_district_ids()`),
      }),
      "aal1",
    );
    expect(r).toEqual({ kind: "citizen", apply: true, admin: false, districts: [] });
  });

  it("app_metadata.kind cannot be set by the user (only via service role)", async () => {
    // raw_user_meta_data is user-controlled; kind is read from raw_app_meta_data only.
    const id = await scalar<string>(
      db,
      `insert into auth.users (phone, raw_user_meta_data) values ('+252615550001', '{"kind":"staff"}') returning id`,
    );
    expect(await scalar(db, `select kind from public.profiles where user_id = $1`, [id])).toBe("citizen");
  });
});

describe("sessions and tokens", () => {
  it("tokens issued before a forced sign-out stop working", async () => {
    const u = await createAuthUser(db, { email: "s@gmail.com", kind: "staff" });
    await asUser(db, superAdmin, (tx) =>
      tx.query(`select public.admin_provision_user($1, 'S', null, array[$2::uuid], true, '{}', false)`, [u, ROLE.auditor]),
    );
    const oldIat = Math.floor(Date.now() / 1000) - 60;
    await asUser(db, superAdmin, (tx) => tx.query(`select public.admin_apply_user_action($1, 'force_signout')`, [u]));
    const before = await as(db, "authenticated", { sub: u, aal: "aal2", iat: oldIat }, (tx) =>
      scalar(tx, `select public.has_permission('audit.view')`),
    );
    const after = await as(db, "authenticated", { sub: u, aal: "aal2", iat: Math.floor(Date.now() / 1000) + 5 }, (tx) =>
      scalar(tx, `select public.has_permission('audit.view')`),
    );
    expect([before, after]).toEqual([false, true]);
  });

  it("the access-token hook adds role and district claims", async () => {
    const out = await scalar<{ claims: Record<string, unknown> }>(
      db,
      `select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{"sub":"x"}'::jsonb))`,
      [superAdmin],
    );
    expect(out.claims).toMatchObject({ sub: "x", user_kind: "staff", all_districts: true });
    expect((out.claims.district_ids as string[]).sort()).toEqual([hodan, wadajir].sort());
  });
});

describe("login lockout", () => {
  it("locks an email after 5 failures and unlocks on success", async () => {
    for (let i = 0; i < 5; i++) {
      await asService(db, (tx) =>
        tx.query(`select public.auth_record_login('lock@gmail.com', null, 'password', false, 'bad', null, null)`),
      );
    }
    const locked = await asService(db, (tx) => scalar<{ locked: boolean }>(tx, `select public.auth_login_precheck('LOCK@gmail.com')`));
    expect(locked.locked).toBe(true);
    await expect(
      asUser(db, superAdmin, (tx) => tx.query(`select public.auth_login_precheck('lock@gmail.com')`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("idempotency", () => {
  it("a second submit with the same key is reported, not repeated", async () => {
    const key = crypto.randomUUID();
    const first = await asUser(db, superAdmin, (tx) => scalar<{ state: string }>(tx, `select public.idempotency_begin($1, 'users.create')`, [key]));
    const second = await asUser(db, superAdmin, (tx) => scalar<{ state: string }>(tx, `select public.idempotency_begin($1, 'users.create')`, [key]));
    await asUser(db, superAdmin, (tx) => tx.query(`select public.idempotency_finish($1, '{"id":1}')`, [key]));
    const third = await asUser(db, superAdmin, (tx) => scalar<{ state: string; result: unknown }>(tx, `select public.idempotency_begin($1, 'users.create')`, [key]));
    expect([first.state, second.state, third]).toEqual(["new", "pending", { state: "done", result: { id: 1 } }]);
  });
});

describe("admin read helpers", () => {
  it("reports 2FA status and role user counts to admins only", async () => {
    await db.query(`insert into auth.mfa_factors (user_id, factor_type, status) values ($1, 'totp', 'verified')`, [superAdmin]);
    const mfa = await asUser(db, superAdmin, (tx) =>
      tx.query<{ has_totp: boolean }>(`select has_totp from public.admin_user_mfa_status(array[$1::uuid])`, [superAdmin]),
    );
    expect(mfa.rows[0]?.has_totp).toBe(true);
    const counts = await asUser(db, superAdmin, (tx) =>
      scalar<number>(tx, `select users::int from public.admin_role_user_counts() where role_id = $1`, [ROLE.super_admin]),
    );
    expect(counts).toBe(1);
  });

  it("the dev seed applies cleanly", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(import.meta.dirname, "..", "seed.sql"), "utf8"));
    expect(await scalar<number>(db, `select count(*)::int from public.districts`)).toBeGreaterThanOrEqual(22);
  });
});

