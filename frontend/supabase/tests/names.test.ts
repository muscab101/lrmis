import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createAuthUser, createDb, scalar } from "./harness";

// System users' names start with a capital letter; printed papers say who served (0284).
let db: PGlite;

beforeAll(async () => {
  db = await createDb();
});

describe("user names and served by (0284)", () => {
  it("every word of a user's name starts with a capital, the rest kept as typed", async () => {
    const id = await createAuthUser(db, { email: "abdi@gmail.com", kind: "staff", fullName: "abdi  hassan McNur" });
    expect(await scalar<string>(db, `select full_name from public.profiles where user_id = $1`, [id])).toBe("Abdi Hassan McNur");
    await db.query(`update public.profiles set full_name = 'faadumo cali' where user_id = $1`, [id]);
    expect(await scalar<string>(db, `select full_name from public.profiles where user_id = $1`, [id])).toBe("Faadumo Cali");
  });

  it("staff_name gives a staff member's full name, and nothing for anyone else", async () => {
    const staff = await createAuthUser(db, { email: "cash@gmail.com", kind: "staff", fullName: "maryan yusuf" });
    const citizen = await createAuthUser(db, { phone: "+252615551212", fullName: "someone" });
    expect(await asUser(db, citizen, (tx) => scalar<string>(tx, `select public.staff_name($1)`, [staff]), "aal1")).toBe("Maryan Yusuf");
    expect(await asUser(db, staff, (tx) => scalar<string | null>(tx, `select public.staff_name($1)`, [citizen]), "aal1")).toBeNull();
  });
});
