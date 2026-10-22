import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let staff: string;
let clerk: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  admin = await bootstrapSuperAdmin(db);
  staff = await createStaff(db, admin, "old.name@gmail.com", ["surveyor"], [hodan]);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
});

describe("admins change a staff member's email (0059)", () => {
  it("updates the profile and signs the user out", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_email($1, ' New.Name@Gmail.com ')`, [staff]));
    const p = await scalar<{ email: string; sessions_revoked_at: string | null }>(db, `select to_jsonb(p) from public.profiles p where user_id = $1`, [staff]);
    expect(p.email).toBe("new.name@gmail.com");
    expect(p.sessions_revoked_at).not.toBeNull();
    expect(await scalar<number>(db, `select count(*)::int from public.audit_log where action = 'user.change_email'`)).toBe(1);
  });

  it("needs users.update and a valid address", async () => {
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.admin_set_user_email($1, 'x@gmail.com')`, [staff]))).rejects.toThrow(/^PERMISSION_DENIED/);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_email($1, 'not-an-email')`, [staff]))).rejects.toThrow(/^VALIDATION/);
  });
});
