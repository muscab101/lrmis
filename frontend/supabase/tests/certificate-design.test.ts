import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let printer: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  printer = await createStaff(db, admin, "print@gmail.com", ["print_officer"], "all");
});

describe("certificate design (0221)", () => {
  it("is a power of its own: the admin role has it, others only when given", async () => {
    expect(await scalar<number>(db, `select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = 'admin' and rp.permission_key = 'certificates.design'`)).toBe(1);
    await expect(asUser(db, printer, (tx) => tx.query(`select public.certificate_design_save($1)`, [JSON.stringify({ accent: "#15803d" })]))).rejects.toThrow(/^PERMISSION_DENIED/);
    await asUser(db, admin, (tx) => tx.query(`select public.user_permissions_set($1, $2, '{}')`, [printer, ["certificates.design"]]));
    const v = await asUser(db, printer, (tx) =>
      scalar<{ accent: string; title_so: string | null; watermark: boolean }>(tx, `select public.certificate_design_save($1)`, [
        JSON.stringify({ accent: "#15803D", title_so: "  ", watermark: false }),
      ]),
    );
    expect(v).toMatchObject({ accent: "#15803d", title_so: null, watermark: false });
    expect(await scalar<string>(db, `select value ->> 'accent' from public.settings where key = 'certificates.design'`)).toBe("#15803d");
  });

  it("refuses a colour that isn't one", async () => {
    await expect(asUser(db, admin, (tx) => tx.query(`select public.certificate_design_save($1)`, [JSON.stringify({ accent: "blue" })]))).rejects.toThrow(/^VALIDATION: colour/);
  });
});
