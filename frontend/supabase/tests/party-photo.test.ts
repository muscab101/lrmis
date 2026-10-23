import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let printer: string;
let agent: string;
let outsider: string;
let party: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Kaaraan','Karaan') returning id`, [region]);
  const admin = await bootstrapSuperAdmin(db);
  printer = await createStaff(db, admin, "printer@gmail.com", ["print_officer"], [hodan]);
  outsider = await createStaff(db, admin, "printer2@gmail.com", ["print_officer"], [karaan]);
  agent = await createStaff(db, admin, "agent@gmail.com", ["agent"], [hodan]);
  party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Cali Xasan', '+252615550101', $1) returning id`, [hodan]);
});

describe("owner photo", () => {
  it("print staff record the photo; the old path comes back for clean-up; staff who can see read it", async () => {
    const first = `${party}/${crypto.randomUUID()}.jpeg`;
    const second = `${party}/${crypto.randomUUID()}.png`;
    expect(await asUser(db, printer, (tx) => scalar(tx, `select public.party_set_photo($1, $2)`, [party, first]))).toBeNull();
    expect(await asUser(db, printer, (tx) => scalar(tx, `select public.party_set_photo($1, $2)`, [party, second]))).toBe(first);
    expect(await asUser(db, printer, (tx) => scalar(tx, `select public.party_photo_path($1)`, [party]))).toBe(second);
  });

  it("rejects paths outside the owner's folder, other districts and staff without the permission", async () => {
    await expect(asUser(db, printer, (tx) => tx.query(`select public.party_set_photo($1, $2)`, [party, `other/${crypto.randomUUID()}.jpeg`]))).rejects.toThrow(/^VALIDATION: photo_path/);
    await expect(asUser(db, outsider, (tx) => tx.query(`select public.party_set_photo($1, $2)`, [party, `${party}/${crypto.randomUUID()}.jpeg`]))).rejects.toThrow(/^DISTRICT_OUT_OF_SCOPE/);
    expect(await asUser(db, outsider, (tx) => scalar(tx, `select public.party_photo_path($1)`, [party]))).toBeNull();
    await expect(asUser(db, agent, (tx) => tx.query(`select public.party_set_photo($1, $2)`, [party, `${party}/${crypto.randomUUID()}.jpeg`]))).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});
