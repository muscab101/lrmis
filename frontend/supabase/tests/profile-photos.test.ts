import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createAuthUser, createDb, scalar } from "./harness";

let db: PGlite;
let admin: string;
let citizen: string;
const set = (user: string, path: string | null) => asUser(db, user, (tx) => scalar<string | null>(tx, `select public.profile_set_avatar($1)`, [path]));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Cali" });
});

describe("profile photos", () => {
  it("anyone sets, changes and removes their own photo, and hears which one it replaced", async () => {
    const first = `${citizen}/11111111-1111-4111-8111-111111111111.png`;
    const second = `${citizen}/22222222-2222-4222-8222-222222222222.jpeg`;
    expect(await set(citizen, first)).toBeNull();
    expect(await set(citizen, second)).toBe(first);
    expect(await scalar<string>(db, `select avatar_path from public.profiles where user_id = $1`, [citizen])).toBe(second);
    expect(await set(citizen, null)).toBe(second);
    expect(await scalar<string | null>(db, `select avatar_path from public.profiles where user_id = $1`, [citizen])).toBeNull();
  });

  it("only into their own folder", async () => {
    await expect(set(admin, `${citizen}/33333333-3333-4333-8333-333333333333.png`)).rejects.toThrow(/^VALIDATION: file/);
    expect(await scalar<string | null>(db, `select avatar_path from public.profiles where user_id = $1`, [citizen])).toBeNull();
  });
});
