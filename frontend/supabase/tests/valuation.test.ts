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

describe("valuation (Phase 5)", () => {
  it("seeds grades and fee types; only valuation staff edit them", async () => {
    expect(await scalar<number>(db, `select count(*)::int from public.property_grades`)).toBeGreaterThanOrEqual(6);
    await expectError(
      asUser(db, clerk, (tx) => tx.query(`select public.valuation_save_grade(null, $1)`, [JSON.stringify({ code: "kiosk", name_so: "Kiosk", name_en: "Kiosk", amount: 5 })])),
      "PERMISSION_DENIED",
    );
    await asUser(db, valuer, (tx) => tx.query(`select public.valuation_save_grade(null, $1)`, [JSON.stringify({ code: "kiosk", name_so: "Kiosk", name_en: "Kiosk", amount: 5 })]));
    await expectError(
      asUser(db, valuer, (tx) => tx.query(`select public.valuation_save_grade(null, $1)`, [JSON.stringify({ code: "kiosk", name_so: "Kiosk", name_en: "Kiosk", amount: 5 })])),
      "CONFLICT: code_taken",
    );
  });

  it("rates keep history: the rate in force on 1 January of the year applies", async () => {
    await asUser(db, valuer, (tx) => tx.query(`select public.valuation_set_rate($1, 'residential', true, 0.5, 10, '2025-01-01')`, [nbhd]));
    await asUser(db, valuer, (tx) => tx.query(`select public.valuation_set_rate($1, 'residential', true, 0.8, 12, '2026-01-01')`, [nbhd]));
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.valuation_set_rate($1, 'residential', true, 0.9, 12, '2026-01-01')`, [nbhd])), "CONFLICT: rate_exists");
    const p25 = await asUser(db, valuer, (tx) => scalar<{ rate_m2: number }>(tx, `select public.assessment_preview($1, 2025)`, [parcel]));
    const p26 = await asUser(db, valuer, (tx) => scalar<{ rate_m2: number; land_amount: number; service_charge: number }>(tx, `select public.assessment_preview($1, 2026)`, [parcel]));
    expect(Number(p25.rate_m2)).toBe(0.5);
    expect(Number(p26.rate_m2)).toBe(0.8);
    expect(Number(p26.land_amount)).toBe(320);
    expect(Number(p26.service_charge)).toBe(12);
  });

  it("staff outside the district can't set rates or see the parcel's valuation", async () => {
    const wadajirValuer = await createStaff(db, admin, "valuer3@gmail.com", ["valuation_officer"], [other]);
    await expectError(asUser(db, wadajirValuer, (tx) => tx.query(`select public.valuation_set_rate($1, 'commercial', true, 1, 0, '2026-01-01')`, [nbhd])), "NOT_FOUND");
    await expectError(asUser(db, wadajirValuer, (tx) => tx.query(`select public.assessment_preview($1, 2026)`, [parcel])), "NOT_FOUND");
  });

  it("assessment = land + buildings − exemption + service charge, stored with its breakdown", async () => {
    await asUser(db, valuer, async (tx) => {
      await tx.query(`select public.building_save(null, $1, $2)`, [parcel, JSON.stringify({ grade_id: GRADE.brick_house, units: 2, floors: 1 })]);
      await tx.query(`select public.building_save(null, $1, $2)`, [parcel, JSON.stringify({ grade_id: GRADE.shop, units: 1 })]);
    });
    // 400 × 0.8 = 320 land; 2 × 45 + 60 = 150 buildings; + 12 service → 482
    const out = await asUser(db, valuer, (tx) => scalar<{ assessment_id: string; total: number }>(tx, `select public.assess_parcel($1, 2026)`, [parcel]));
    expect(Number(out.total)).toBe(482);
    const row = await scalar<{ number: string; land_amount: string; buildings_amount: string; status: string }>(
      db,
      `select row_to_json(a) from public.assessments a where id = $1`,
      [out.assessment_id],
    );
    expect(row.number).toMatch(/^ASM-2026-000001$/);
    expect(Number(row.buildings_amount)).toBe(150);
    expect(row.status).toBe("issued");
  });

  it("an approved exemption (by someone else) reduces land + buildings, not the service charge", async () => {
    const ex = await asUser(db, valuer, (tx) => scalar<string>(tx, `select public.exemption_request($1, 'hardship', 50, 'Widow, single income', '2026-01-01', null)`, [parcel]));
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.exemption_decide($1, true, 'ok')`, [ex])), "MAKER_CHECKER");
    await asUser(db, valuer2, (tx) => tx.query(`select public.exemption_decide($1, true, 'Checked with the district')`, [ex]));
    const out = await asUser(db, valuer, (tx) => scalar<{ assessment_id: string; total: number }>(tx, `select public.assess_parcel($1, 2026)`, [parcel]));
    // (320 + 150) × 50 % = 235 off → 235 + 12 = 247
    expect(Number(out.total)).toBe(247);
    expect(await scalar<number>(db, `select count(*)::int from public.assessments where parcel_id = $1 and year = 2026 and status = 'issued'`, [parcel])).toBe(1);
    expect(await scalar<number>(db, `select count(*)::int from public.assessments where parcel_id = $1 and status = 'superseded'`, [parcel])).toBe(1);
  });

  it("the owner can appeal; while open, re-assessment waits; an upheld appeal issues a corrected assessment", async () => {
    const live = await scalar<string>(db, `select id from public.assessments where parcel_id = $1 and year = 2026 and status = 'issued'`, [parcel]);
    const visible = await asUser(db, citizen, (tx) => tx.query(`select id from public.assessments where id = $1`, [live]), "aal1");
    expect(visible.rows).toHaveLength(1);
    const appeal = await asUser(db, citizen, (tx) => scalar<string>(tx, `select public.appeal_file($1, 'The shop closed last year; it is now a store room.', 200)`, [live]), "aal1");
    await expectError(asUser(db, citizen, (tx) => tx.query(`select public.appeal_file($1, 'A second appeal on the same assessment', null)`, [live]), "aal1"), "CONFLICT: appeal_open");
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.assess_parcel($1, 2026)`, [parcel])), "CONFLICT: appeal_open");
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.appeal_decide($1, 'upheld', 300, '')`, [appeal])), "VALIDATION: note_required");
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.appeal_decide($1, 'upheld', 999, 'too high')`, [appeal])), "VALIDATION: new_total");
    const res = await asUser(db, valuer, (tx) => scalar<{ new_assessment_id: string }>(tx, `select public.appeal_decide($1, 'upheld', 200, 'Shop unit removed after inspection')`, [appeal]));
    const fresh = await scalar<{ total: string; status: string; override_note: string }>(db, `select row_to_json(a) from public.assessments a where id = $1`, [res.new_assessment_id]);
    expect(Number(fresh.total)).toBe(200);
    expect(fresh.status).toBe("issued");
    expect(fresh.override_note).toMatch(/^Appeal:/);
  });

  it("other citizens can't see or appeal the assessment; unregistered parcels can't be assessed", async () => {
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    const live = await scalar<string>(db, `select id from public.assessments where parcel_id = $1 and status = 'issued'`, [parcel]);
    const seen = await asUser(db, stranger, (tx) => tx.query(`select id from public.assessments`), "aal1");
    expect(seen.rows).toHaveLength(0);
    await expectError(asUser(db, stranger, (tx) => tx.query(`select public.appeal_file($1, 'Not my parcel but I object', null)`, [live]), "aal1"), "NOT_FOUND");
    const draft = await scalar<string>(
      db,
      `insert into public.parcels (district_id, neighbourhood_id, area_m2, geom, status)
       values ($1, $2, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'verified') returning id`,
      [hodan, nbhd, JSON.stringify(square(45.301, 2.041, 0.0001))],
    );
    await expectError(asUser(db, valuer, (tx) => tx.query(`select public.assess_parcel($1, 2026)`, [draft])), "CONFLICT: parcel_not_registered");
  });

  it("assesses a whole neighbourhood, skipping parcels with an open appeal", async () => {
    const out = await asUser(db, valuer, (tx) => scalar<{ assessed: number; skipped: number }>(tx, `select public.assess_neighbourhood($1, 2025)`, [nbhd]));
    expect(out).toEqual({ assessed: 1, skipped: 0 });
  });
});

describe("deleting a fee type (0055)", () => {
  it("built-in fees are switched off; a used one is switched off; an unused one is removed", async () => {
    const admin = await scalar<string>(db, `select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'super_admin' limit 1`);
    const reg = await scalar<string>(db, `select id from public.fee_types where code = 'registration_fee'`);
    // A built-in fee is switched off, not deleted (0057).
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.valuation_delete_fee_type($1)`, [reg]))).toBe("hidden");
    expect(await scalar<boolean>(db, `select active from public.fee_types where id = $1`, [reg])).toBe(false);
    await db.query(`update public.fee_types set active = true where id = $1`, [reg]);
    const mk = (code: string) =>
      asUser(db, admin, (tx) => scalar<string>(tx, `select public.valuation_save_fee_type(null, $1)`, [JSON.stringify({ code, name_so: code, name_en: code, interval: "one_off", amount: 5 })]));
    const unused = await mk("trial_fee");
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.valuation_delete_fee_type($1)`, [unused]))).toBe("deleted");
    expect(await scalar<number>(db, `select count(*)::int from public.fee_types where id = $1`, [unused])).toBe(0);
    const used = await mk("market_fee");
    const parcel = await scalar<{ id: string; district_id: string }>(db, `select to_jsonb(p) from public.parcels p limit 1`);
    await db.query(`insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('INV-2026-009901', $1, $2, $3, 'x', current_date + 30, 5)`, [parcel.id, parcel.district_id, used]);
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.valuation_delete_fee_type($1)`, [used]))).toBe("hidden");
    expect(await scalar<boolean>(db, `select active from public.fee_types where id = $1`, [used])).toBe(false);
  });
});
