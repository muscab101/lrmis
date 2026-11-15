import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createAuthUser, createDb, scalar } from "./harness";

let db: PGlite;
let admin: string;
let citizen: string;

const read = (role: "anon" | "authenticated", sub?: string) =>
  as(db, role, sub ? { sub, aal: "aal1" } : {}, (tx) =>
    scalar<Record<string, string> | null>(tx, `select value from public.settings where key = 'payments.bank_account'`),
  );

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  citizen = await createAuthUser(db, { phone: "+252610009988", fullName: "Test Citizen" });
});

describe("bank account for citizen transfers", () => {
  it("starts empty and is readable by citizens and the public pay page", async () => {
    expect((await read("authenticated", citizen))?.account_no).toBe("");
    expect((await read("anon"))?.account_no).toBe("");
  });

  it("only settings.update can set it; values are trimmed", async () => {
    await expect(
      asUser(db, citizen, (tx) => tx.query(`select public.payment_bank_account_set('{"account_no":"1"}'::jsonb)`), "aal1"),
    ).rejects.toThrow(/^PERMISSION_DENIED/);
    await asUser(db, admin, (tx) =>
      tx.query(`select public.payment_bank_account_set($1::jsonb)`, [
        JSON.stringify({ bank: " Test Bank ", account_name: "Banadir Revenue", account_no: "0011223344", swift: "tstbsomo" }),
      ]),
    );
    const v = await read("anon");
    expect(v).toMatchObject({ bank: "Test Bank", account_no: "0011223344", swift: "TSTBSOMO", branch: "" });
  });
});
