import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let hodan: string;
let nbhd: string;
let registrar: string;
let admin: string;
let surveyor: string;
let landOfficer: string;
let n = 0;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

/** A parcel with one owner; registered or partial. */
async function parcel(registered: boolean) {
  n += 1;
  const id = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, plot_width_m, plot_length_m, geom, status, registered_at, house_no)
     values ($1, $2, $3, $4, 'residential', 100, 10, 10, extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), $6, $7, $8) returning id`,
    [registered ? `BNHDN0129${n}` : null, registered ? `HDN000099${n}` : null, hodan, nbhd, JSON.stringify(square(45.3 + n * 0.0003, 2.04, 0.0001)), registered ? "registered" : "draft", registered ? new Date().toISOString() : null, String(n)],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ($1, '+252615550101', $2) returning id`, [`Owner ${n}`, hodan]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [id, party]);
  return id;
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  const sa = await bootstrapSuperAdmin(db);
  registrar = await createStaff(db, sa, "registrar@gmail.com", ["registrar"], [hodan]);
  admin = await createStaff(db, sa, "admin@gmail.com", ["admin"], [hodan]);
  surveyor = await createStaff(db, sa, "surveyor@gmail.com", ["surveyor"], [hodan]);
  landOfficer = await createStaff(db, sa, "land@gmail.com", ["land_officer"], [hodan]);
});

describe("registered land is visible only to roles allowed to see it", () => {
  it("an admin switches 'See registered land' off for a role: its users still see partial land, not registered", async () => {
    const reg = await parcel(true);
    const part = await parcel(false);
    const sees = (who: string, id: string) => asUser(db, who, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where id = $1`, [id]));
    expect(await sees(landOfficer, reg)).toBe(1);
    await db.query(`delete from public.role_permissions where permission_key = 'parcels.registered' and role_id = (select id from public.roles where key = 'land_officer')`);
    expect(await sees(landOfficer, reg)).toBe(0);
    expect(await sees(landOfficer, part)).toBe(1);
  });
});

describe("deleting land", () => {
  it("registrars delete partial land, not registered land; admins delete registered land; a reason is needed", async () => {
    const part = await parcel(false);
    const reg = await parcel(true);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_delete($1, 'no')`, [part])), "VALIDATION: reason");
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_delete($1, 'Recorded twice by mistake')`, [part]));
    expect(await scalar<string | null>(db, `select delete_reason from public.parcels where id = $1`, [part])).toBe("Recorded twice by mistake");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_delete($1, 'Wrong house entirely')`, [reg])), "PERMISSION_DENIED");
    // Its unpaid bill is cancelled with it.
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const inv = await scalar<string>(
      db,
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total) values (private.invoice_number(2026), $1, $2, $3, '2026', current_date, current_date + 30, 40) returning id`,
      [reg, hodan, tax],
    );
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'Wrong house entirely')`, [reg]));
    expect(await scalar<string>(db, `select status::text from public.invoices where id = $1`, [inv])).toBe("cancelled");
  });

  it("land with money received can't be deleted", async () => {
    const reg = await parcel(true);
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const inv = await scalar<string>(
      db,
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total) values (private.invoice_number(2026), $1, $2, $3, '2026', current_date, current_date + 30, 40) returning id`,
      [reg, hodan, tax],
    );
    await db.query(`select private.record_payment(jsonb_build_object('parcel_id', $1::text, 'invoice_id', $2::text, 'method', 'cash', 'amount', 10))`, [reg, inv]);
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'Wrong house entirely')`, [reg])), "CONFLICT: has_payments");
  });
});

describe("check if it exists", () => {
  it("sends a district surveyor; 'not found' stops registering; 'exists' lets it through", async () => {
    const part = await parcel(false);
    const assigned = await asUser(db, registrar, (tx) => scalar<string>(tx, `select public.parcel_request_site_check($1, null, 'Neighbours say it was demolished')`, [part]));
    expect(assigned).toBe(surveyor);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_request_site_check($1)`, [part])), "CONFLICT: site_check_pending");
    // The surveyor sees the land they're sent to.
    expect(await asUser(db, surveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where id = $1`, [part]))).toBe(1);
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.parcel_confirm_site($1, false, 'no')`, [part])), "VALIDATION: note_required");
    await asUser(db, surveyor, (tx) => tx.query(`select public.parcel_confirm_site($1, false, 'Empty plot, no house')`, [part]));
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_register($1)`, [part])), "CONFLICT: site_not_found");
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_request_site_check($1)`, [part]));
    await asUser(db, surveyor, (tx) => tx.query(`select public.parcel_confirm_site($1, true)`, [part]));
    const r = await asUser(db, registrar, (tx) => scalar<{ pun: string }>(tx, `select public.parcel_register($1)`, [part]));
    expect(r.pun).toMatch(/^BN/);
  });
});

describe("registering land that was started through an old application", () => {
  it("works: owners come back from the application, the PUN is given, the application closes", async () => {
    const part = await parcel(false);
    const cashier = await createStaff(db, await scalar<string>(db, `select user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'super_admin' limit 1`), "cashier@gmail.com", ["cashier"], [hodan]);
    // The old flow moved the owners onto an application.
    await asUser(db, surveyor, (tx) => tx.query(`select public.field_land_start_registration($1)`, [part]));
    const app = await scalar<string>(db, `select application_id from public.parcels where id = $1`, [part]);
    await db.query(`update public.property_grades set amount = 1 where code = (select code from public.property_grades order by sort limit 1)`);
    await db.query(`update public.parcels set property_type = (select code from public.property_grades order by sort limit 1) where id = $1`, [part]);
    const r = await asUser(db, registrar, (tx) => scalar<{ pun: string }>(tx, `select public.parcel_register($1)`, [part]));
    expect(r.pun).toMatch(/^BN/);
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("approved");
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1 and valid_to is null`, [part])).toBe(1);
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and title_en like $2`, [cashier, `%${r.pun}%`])).toBeGreaterThan(0);
  });
});

describe("owners: who sees and deletes registered owners", () => {
  it("partial owners: registrars delete them once their land is gone; registered owners: admins only, with a reason", async () => {
    const part = await parcel(false);
    const partOwner = await scalar<string>(db, `select party_id from public.parcel_owners where parcel_id = $1`, [part]);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [partOwner])), "HAS_RECORDS");
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_delete($1, 'Recorded twice')`, [part]));
    await asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1)`, [partOwner]));

    const reg = await parcel(true);
    const regOwner = await scalar<string>(db, `select party_id from public.parcel_owners where parcel_id = $1`, [reg]);
    await db.query(`update public.parties set registered_at = now() where id = $1`, [regOwner]);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'Wrong house entirely')`, [reg]));
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.party_delete($1, 'Duplicate person')`, [regOwner])), "PERMISSION_DENIED");
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.party_delete($1)`, [regOwner])), "VALIDATION: reason");
    await asUser(db, admin, (tx) => tx.query(`select public.party_delete($1, 'Duplicate person')`, [regOwner]));
    expect(await scalar<string>(db, `select delete_reason from public.parties where id = $1`, [regOwner])).toBe("Duplicate person");
  });

  it("an admin switches 'See registered owners' off for a role: registered owners disappear for it", async () => {
    const reg = await parcel(true);
    const owner = await scalar<string>(db, `select party_id from public.parcel_owners where parcel_id = $1`, [reg]);
    await db.query(`update public.parties set registered_at = now() where id = $1`, [owner]);
    const sees = () => asUser(db, registrar, (tx) => scalar<number>(tx, `select count(*)::int from public.parties where id = $1`, [owner]));
    expect(await sees()).toBe(1);
    await db.query(`delete from public.role_permissions where permission_key = 'owners.registered' and role_id = (select id from public.roles where key = 'registrar')`);
    expect(await sees()).toBe(0);
  });
});
