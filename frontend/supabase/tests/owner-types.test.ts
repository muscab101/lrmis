import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let valuer: string;
let clerk: string;
let hodan: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const saveType = (user: string, name: string, id: string | null = null, active = true) =>
  asUser(db, user, (tx) => scalar<string>(tx, `select public.owner_type_save($1, $2)`, [id, { name_so: name, name_en: name, active }]));
const saveOwner = (user: string, type: string | null, id: string | null = null) =>
  asUser(db, user, (tx) => scalar<string>(tx, `select public.save_party($1, $2)`, [id, { kind: "person", full_name: "Cali Xasan", district_id: hodan, owner_type_id: type }]));

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const admin = await bootstrapSuperAdmin(db);
  valuer = await createStaff(db, admin, "valuer@gmail.com", ["valuation_officer"], [hodan]);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await db.query(`insert into public.role_permissions (role_id, permission_key)
    select r.id, k from public.roles r, unnest(array['owners.create', 'owners.update']) k where r.key = 'front_desk_clerk' on conflict do nothing`);
});

describe("owner types", () => {
  it("come with a starting list everyone signed in can read", async () => {
    const rows = await asUser(db, clerk, (tx) => tx.query<{ name_en: string }>(`select name_en from public.owner_types`));
    expect(rows.rows.map((r) => r.name_en)).toContain("Individual");
  });

  it("are added and changed from Valuation only, and names can't repeat", async () => {
    const id = await saveType(valuer, "Embassy");
    await saveType(valuer, "Embassies", id);
    expect(await scalar<string>(db, `select name_en from public.owner_types where id = $1`, [id])).toBe("Embassies");
    await expectError(saveType(valuer, "embassies"), "CONFLICT: owner_type_taken");
    await expectError(saveType(clerk, "Not allowed"), "PERMISSION_DENIED");
    await expect(asUser(db, valuer, (tx) => tx.query(`insert into public.owner_types (name_so, name_en) values ('xx', 'xx')`))).rejects.toThrow();
  });

  it("are saved on the owner; other saves leave the type alone", async () => {
    const type = await saveType(valuer, "School");
    const owner = await saveOwner(clerk, type);
    expect(await scalar<string>(db, `select owner_type_id from public.parties where id = $1`, [owner])).toBe(type);
    await saveOwner(clerk, null, owner);
    expect(await scalar<string>(db, `select owner_type_id from public.parties where id = $1`, [owner])).toBe(type);
  });

  it("delete when unused; in use they are switched off, and the owner keeps theirs but nobody new gets it", async () => {
    const free = await saveType(valuer, "Unused");
    expect(await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.owner_type_delete($1)`, [free]))).toBe("deleted");

    const used = await saveType(valuer, "Hospital");
    const owner = await saveOwner(clerk, used);
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.owner_type_delete($1)`, [used])), "PERMISSION_DENIED");
    expect(await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.owner_type_delete($1)`, [used]))).toBe("hidden");
    await saveOwner(clerk, used, owner);
    await expectError(saveOwner(clerk, used), "VALIDATION: owner_type");
  });
});
