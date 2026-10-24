import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar } from "./harness";

let db: PGlite;
let clerk: string;
let registrar: string;
let otherRegistrar: string;
let hodan: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const draft = (by: string, p: Record<string, unknown>) =>
  asUser(db, by, (tx) => scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ district_id: hodan, ...p })]));
const registeredAt = (id: string) => scalar<string | null>(db, `select registered_at from public.parties where id = $1`, [id]);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const admin = await bootstrapSuperAdmin(db);
  clerk = await createStaff(db, admin, "entry@gmail.com", ["data_entry_clerk"], [hodan]);
  await letClerksCreate(db);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  otherRegistrar = await createStaff(db, admin, "registrar.wdj@gmail.com", ["registrar"], [wadajir]);
});

describe("owner registration (draft → registered)", () => {
  it("new owners start as drafts", async () => {
    const id = await draft(clerk, { full_name: "Muscab Musa", phone: "+252618037991" });
    expect(await registeredAt(id)).toBeNull();
  });

  it("a clerk can't register or delete; the registrar can register", async () => {
    const id = await draft(clerk, { full_name: "Xasan Cali", phone: "+252618000001" });
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.party_register($1)`, [id])), "PERMISSION_DENIED");
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.party_delete($1)`, [id])), "PERMISSION_DENIED");
    await asUser(db, registrar, (tx) => tx.query(`select public.party_register($1)`, [id]));
    expect(await registeredAt(id)).not.toBeNull();
    expect(await scalar<string>(db, `select registered_by from public.parties where id = $1`, [id])).toBe(registrar);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_register($1)`, [id])), "CONFLICT");
  });

  it("registering needs an ID document or a phone number", async () => {
    const id = await draft(clerk, { full_name: "No Contact" });
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_register($1)`, [id])), "VALIDATION");
  });

  it("registrars delete drafts in their districts; registered owners are left to admins", async () => {
    const id = await draft(clerk, { full_name: "Typo Entry" });
    await expectError(asUser(db, otherRegistrar, (tx) => tx.query(`select public.party_delete($1)`, [id])), "(DISTRICT_OUT_OF_SCOPE|NOT_FOUND)");
    await asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [id]));
    expect(await scalar<string | null>(db, `select deleted_at from public.parties where id = $1`, [id])).not.toBeNull();
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [id])), "NOT_FOUND");

    const reg = await draft(clerk, { full_name: "Kept Owner", phone: "+252618000002" });
    await asUser(db, registrar, (tx) => tx.query(`select public.party_register($1)`, [reg]));
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [reg])), "PERMISSION_DENIED");
  });

  it("an owner named on an application can't be deleted", async () => {
    const id = await draft(clerk, { full_name: "On Application" });
    const app = await scalar<string>(
      db,
      `insert into public.applications (number, channel, district_id, status) values ('APP-2026-000901', 'office', $1, 'draft') returning id`,
      [hodan],
    );
    await db.query(`insert into public.application_parties (application_id, party_id, role) values ($1, $2, 'owner')`, [app, id]);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [id])), "HAS_RECORDS");
  });
});
