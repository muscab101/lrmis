import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let valuer: string;
let valuer2: string;
let clerk: string;
let citizen: string;
let hodan: string;
let other: string;
let nbhd: string;
let parcel: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const GRADE: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  other = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  valuer = await createStaff(db, admin, "valuer@gmail.com", ["valuation_officer"], [hodan]);
  valuer2 = await createStaff(db, admin, "valuer2@gmail.com", ["valuation_officer"], [hodan]);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Owner" });
  for (const r of (await db.query<{ code: string; id: string }>(`select code, id from public.property_grades`)).rows) GRADE[r.code] = r.id;

  // A registered 400 m² residential, developed parcel owned by the citizen.
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, developed, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', true, 400,
             extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, citizen_user_id) values ('Owner', '+252615550101', $1) returning id`, [citizen]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
});

describe("edit and delete on the Valuation tabs (0056)", () => {
  it("grades: an unused grade is deleted; a grade used by land is switched off", async () => {
    const g = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.valuation_save_grade(null, '{"code":"trial_grade","name_so":"Tijaabo","name_en":"Trial","amount":1}')`));
    expect(await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.valuation_delete_grade($1)`, [g]))).toBe("deleted");
    await db.query(`update public.parcels set property_type = 'villa' where id = $1`, [parcel]);
    expect(await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.valuation_delete_grade($1)`, [GRADE.villa]))).toBe("hidden");
    await db.query(`update public.property_grades set active = true where code = 'villa'`);
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.valuation_delete_grade($1)`, [GRADE.villa])), "PERMISSION_DENIED");
  });

  it("rates: edited and deleted until an assessment uses them", async () => {
    const r = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.valuation_set_rate($1, 'residential', true, 0.5, 10, '2026-01-01')`, [nbhd]));
    await asUser(db, valuer, (tx) => tx.query(`select public.valuation_update_rate($1, '{"rate_m2":0.6,"service_charge":11,"valid_from":"2026-01-01","note":"fixed"}')`, [r]));
    expect(Number(await scalar<string>(db, `select rate_m2::text from public.neighbourhood_rates where id = $1`, [r]))).toBe(0.6);
    const spare = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.valuation_set_rate($1, 'commercial', true, 2, 0, '2026-01-01')`, [nbhd]));
    await asUser(db, valuer, (tx) => tx.query(`select public.valuation_delete_rate($1)`, [spare]));
    expect(await scalar<number>(db, `select count(*)::int from public.neighbourhood_rates where id = $1`, [spare])).toBe(0);
    await asUser(db, valuer, (tx) => tx.query(`select public.assess_parcel($1, 2026)`, [parcel]));
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.valuation_update_rate($1, '{"rate_m2":0.7}')`, [r])), "CONFLICT: rate_in_use");
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.valuation_delete_rate($1)`, [r])), "CONFLICT: rate_in_use");
  });

  it("assessments: deleting the live one brings back the one it replaced", async () => {
    const first = await scalar<string>(db, `select id from public.assessments where parcel_id = $1 and year = 2026 and status = 'issued'`, [parcel]);
    await asUser(db, valuer, (tx) => tx.query(`select public.assess_parcel($1, 2026)`, [parcel]));
    const second = await scalar<string>(db, `select id from public.assessments where parcel_id = $1 and year = 2026 and status = 'issued'`, [parcel]);
    expect(second).not.toBe(first);
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.assessment_delete($1)`, [first])), "CONFLICT: assessment_superseded");
    await asUser(db, valuer, (tx) => tx.query(`select public.assessment_delete($1)`, [second]));
    expect(await scalar<string>(db, `select status::text from public.assessments where id = $1`, [first])).toBe("issued");
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.assessment_delete($1)`, [first])), "PERMISSION_DENIED");
  });

  it("exemptions: edited and deleted while pending only", async () => {
    const ex = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.exemption_request($1, 'hardship', 50, 'Widow, single income', '2026-01-01', null)`, [parcel]));
    await asUser(db, valuer, (tx) => tx.query(`select public.exemption_update($1, '{"kind":"hardship","pct":40,"reason":"Widow, two children","valid_from":"2026-01-01"}')`, [ex]));
    expect(Number(await scalar<string>(db, `select pct::text from public.exemptions where id = $1`, [ex]))).toBe(40);
    await asUser(db, valuer, (tx) => tx.query(`select public.exemption_delete($1)`, [ex]));
    const ex2 = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.exemption_request($1, 'hardship', 50, 'Second request', '2026-01-01', null)`, [parcel]));
    await asUser(db, valuer2, (tx) => tx.query(`select public.exemption_decide($1, false, 'No proof')`, [ex2]));
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.exemption_delete($1)`, [ex2])), "CONFLICT: decided");
  });

  it("appeals: the filer or valuation staff edit and delete an open appeal", async () => {
    const live = await scalar<string>(db, `select id from public.assessments where parcel_id = $1 and year = 2026 and status = 'issued'`, [parcel]);
    const appeal = await asUser(db, citizen, (tx) => scalar<string>(tx, `select public.appeal_file($1, 'The shop closed last year; it is now a store room.', 200)`, [live]), "aal1");
    await asUser(db, citizen, (tx) => tx.query(`select public.appeal_update($1, 'The shop closed in March; it is a store room now.', 180)`, [appeal]), "aal1");
    expect(Number(await scalar<string>(db, `select requested_total::text from public.appeals where id = $1`, [appeal]))).toBe(180);
    await expectError(asUser(db, citizen, (tx) => tx.query(`select public.appeal_update($1, 'short', null)`, [appeal]), "aal1"), "VALIDATION");
    // An assessment under appeal can't be deleted.
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.assessment_delete($1)`, [live])), "CONFLICT: assessment_appealed");
    await asUser(db, valuer, (tx) => tx.query(`select public.appeal_delete($1)`, [appeal]));
    expect(await scalar<number>(db, `select count(*)::int from public.appeals where id = $1`, [appeal])).toBe(0);
  });
});
