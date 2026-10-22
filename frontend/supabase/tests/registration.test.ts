import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let clerk: string;
let finance: string;
let landOfficer: string;
let gis: string;
let surveyor: string;
let registrar: string;
let legal: string;
let citizen: string;
let hodan: string;
let nbhd: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

/** Front desk opens a complete application with one owner (100 %) and the required documents. */
async function submittedApplication(lon: number, lat: number): Promise<string> {
  const owner = await asUser(db, clerk, (tx) =>
    scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: `Owner ${lon}`, phone: "+252611234567", district_id: hodan })]),
  );
  return asUser(db, clerk, async (tx) => {
    const app = await scalar<{ id: string }>(tx, `select public.application_create($1)`, [
      JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: lon, pin_lat: lat }),
    ]);
    await tx.query(`select public.application_set_parties($1, $2)`, [app.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]);
    await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 10)`, [app.id, `${app.id}/id.pdf`]);
    await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'd.pdf', 'application/pdf', 10)`, [app.id, `${app.id}/d.pdf`]);
    await tx.query(`select public.application_submit($1)`, [app.id]);
    return app.id;
  });
}

const status = (id: string) => scalar<string>(db, `select status::text from public.applications where id = $1`, [id]);

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
  admin = await bootstrapSuperAdmin(db);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  landOfficer = await createStaff(db, admin, "land@gmail.com", ["land_officer"], [hodan]);
  gis = await createStaff(db, admin, "gis@gmail.com", ["gis_officer"], [hodan]);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  legal = await createStaff(db, admin, "legal@gmail.com", ["legal_officer"], [hodan]);
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Neighbour" });
});

describe("§10 Golden Path steps 2–4: fee → survey → verify → notice → register", () => {
  let app: string;
  let survey: string;
  const plot = square(45.3, 2.04, 0.0002); // ~44 m × 44 m inside the neighbourhood

  it("goes straight to review with the fee still due; finance can waive it (not the creator)", async () => {
    app = await submittedApplication(45.3, 2.04);
    expect(await status(app)).toBe("in_survey");
    expect(await scalar<string>(db, `select fee_status::text from public.applications where id = $1`, [app])).toBe("due");
    await expectError(asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, '')`, [app])), "VALIDATION: note_required");
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Hardship case')`, [app]));
    expect(await status(app)).toBe("in_survey");
  });

  it("assigns the least-busy surveyor of the district automatically", async () => {
    const candidates = await asUser(db, landOfficer, (tx) => tx.query<{ user_id: string }>(`select user_id from public.survey_candidates($1)`, [app]));
    expect(candidates.rows.map((r) => r.user_id)).toEqual([surveyor]);
    survey = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1)`, [app]));
    expect(await scalar(db, `select surveyor_id from public.surveys where id = $1`, [survey])).toBe(surveyor);
  });

  it("only the assigned surveyor can work on it; invalid polygons are rejected, not repaired", async () => {
    await expectError(
      asUser(db, gis, (tx) => tx.query(`select public.survey_save($1, $2)`, [survey, JSON.stringify({ geojson: plot })])),
      "PERMISSION_DENIED",
    );
    const bowtie = { type: "Polygon", coordinates: [[[45.3, 2.04], [45.3002, 2.0402], [45.3002, 2.04], [45.3, 2.0402], [45.3, 2.04]]] };
    await expectError(
      asUser(db, surveyor, (tx) => tx.query(`select public.survey_save($1, $2)`, [survey, JSON.stringify({ geojson: bowtie })])),
      "VALIDATION: invalid_polygon",
    );
  });

  it("saves the boundary with server-computed area and perimeter, then submits cleanly", async () => {
    const r = await asUser(db, surveyor, (tx) =>
      scalar<{ area_m2: number; perimeter_m: number }>(tx, `select public.survey_save($1, $2)`, [
        survey,
        JSON.stringify({ geojson: plot, method: "drawn", neighbours: { north: "Road", east: "Ali", south: "Shop", west: "School" }, building: { type: "brick_house", floors: 1 } }),
      ]),
    );
    expect(Number(r.area_m2)).toBeGreaterThan(1900);
    expect(Number(r.area_m2)).toBeLessThan(2000);
    expect(Number(r.perimeter_m)).toBeGreaterThan(170);
    const out = await asUser(db, surveyor, (tx) => scalar<{ status: string }>(tx, `select public.survey_submit($1)`, [survey]));
    expect(out.status).toBe("submitted");
    expect(await status(app)).toBe("surveyed");
    expect(await scalar(db, `select status::text from public.parcels where application_id = $1`, [app])).toBe("surveyed");
  });

  it("the land officer's checklist must be complete; verifying starts a 14-day public notice", async () => {
    await expectError(
      asUser(db, landOfficer, (tx) => tx.query(`select public.application_verify($1, '{"documents_ok":true}')`, [app])),
      "VALIDATION: checklist_incomplete",
    );
    const r = await asUser(db, landOfficer, (tx) =>
      scalar<{ status: string; notice_days: number }>(tx, `select public.application_verify($1, $2, 'All good')`, [
        app,
        JSON.stringify({ documents_ok: true, survey_ok: true, identity_ok: true }),
      ]),
    );
    expect(r).toEqual({ status: "public_notice", notice_days: 14 });
    const board = await as(db, "anon", {}, (tx) => tx.query<Record<string, unknown>>(`select * from public.public_notices_active()`));
    expect(board.rows).toHaveLength(1);
    expect(JSON.stringify(board.rows[0])).not.toContain("Owner");
  });

  it("registration waits for the notice period; an open objection blocks it until resolved", async () => {
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.application_register($1)`, [app])), "CONFLICT: notice_running");
    const notice = await scalar<string>(db, `select id from public.public_notices where application_id = $1`, [app]);
    await asUser(db, citizen, (tx) => tx.query(`select public.objection_file($1, 'Neighbour', null, 'The east wall is on my land.')`, [notice]), "aal1");
    // Notice period ends; the daily job (pg_cron) closes it.
    await db.query(`update public.public_notices set ends_at = now() - interval '1 minute' where id = $1`, [notice]);
    expect(await asService(db, (tx) => scalar<number>(tx, `select public.close_due_notices()`))).toBe(1);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.application_register($1)`, [app])), "CONFLICT: open_objection");
    expect(await status(app)).toBe("in_verification");

    const objection = await scalar<string>(db, `select id from public.objections where notice_id = $1`, [notice]);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.objection_resolve($1, 'dismissed', 'x')`, [objection])), "PERMISSION_DENIED");
    // The legal officer reads the case (application + objections) on the application page.
    const seen = await asUser(db, legal, (tx) =>
      tx.query<{ n: number }>(`select count(*)::int as n from public.objections o join public.applications a on a.id = (select application_id from public.public_notices where id = o.notice_id) where o.id = $1`, [objection]),
    );
    expect(seen.rows[0]!.n).toBe(1);
    await asUser(db, legal, (tx) => tx.query(`select public.objection_resolve($1, 'dismissed', 'Survey shows the wall inside the plot')`, [objection]));
  });

  it("the registrar registers: PUN + account number generated, owners recorded", async () => {
    const r = await asUser(db, registrar, (tx) => scalar<{ pun: string; account_no: string }>(tx, `select public.application_register($1, 'residential')`, [app]));
    expect(r).toMatchObject({ pun: "BN-HDN-012-01", account_no: "HDN0000001" });
    expect(await status(app)).toBe("approved");
    const parcel = await db.query<{ status: string; owners: number }>(
      `select p.status::text, (select count(*)::int from public.parcel_owners po where po.parcel_id = p.id and po.valid_to is null) as owners
       from public.parcels p where p.application_id = $1`,
      [app],
    );
    expect(parcel.rows[0]).toEqual({ status: "registered", owners: 1 });
  });

  it("serials are gapless per district: the next parcel gets 000002", async () => {
    const second = await submittedApplication(45.302, 2.042);
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Mosque')`, [second]));
    const s = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1)`, [second]));
    await asUser(db, surveyor, async (tx) => {
      await tx.query(`select public.survey_save($1, $2)`, [s, JSON.stringify({ geojson: square(45.302, 2.042, 0.0002) })]);
      await tx.query(`select public.survey_submit($1)`, [s]);
    });
    await asUser(db, landOfficer, (tx) =>
      tx.query(`select public.application_verify($1, '{"documents_ok":true,"survey_ok":true,"identity_ok":true}')`, [second]),
    );
    await db.query(`update public.public_notices set ends_at = now() - interval '1 minute' where application_id = $1`, [second]);
    const r = await asUser(db, registrar, (tx) => scalar<{ pun: string }>(tx, `select public.application_register($1)`, [second]));
    expect(r.pun).toBe("BN-HDN-012-02");
  });

  it("PUN numbers keep one leading zero at most and never cut longer numbers", async () => {
    const fmt = (n: number) => scalar<string>(db, `select private.format_serial('BN-{district}-{neighbourhood}-{serial:2}', 'HDN', '012', $1)`, [n]);
    expect([await fmt(3), await fmt(10), await fmt(100), await fmt(12345)]).toEqual(["BN-HDN-012-03", "BN-HDN-012-10", "BN-HDN-012-100", "BN-HDN-012-12345"]);
  });
});

describe("GIS validation", () => {
  it("rejects a parcel outside its neighbourhood", async () => {
    const app = await submittedApplication(45.3, 2.04);
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Test')`, [app]));
    const s = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1)`, [app]));
    await asUser(db, surveyor, (tx) => tx.query(`select public.survey_save($1, $2)`, [s, JSON.stringify({ geojson: square(45.31, 2.05, 0.0002) })]));
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.survey_submit($1)`, [s])), "VALIDATION: outside_neighbourhood");
  });

  it("sends overlaps to a GIS officer, who must remove them before accepting", async () => {
    const app = await submittedApplication(45.3001, 2.0401);
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Test')`, [app]));
    const s = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1)`, [app]));
    // Overlaps the registered parcel around (45.3, 2.04).
    await asUser(db, surveyor, (tx) => tx.query(`select public.survey_save($1, $2)`, [s, JSON.stringify({ geojson: square(45.3002, 2.0402, 0.0002) })]));
    const out = await asUser(db, surveyor, (tx) => scalar<{ status: string; overlaps: { pun: string }[] }>(tx, `select public.survey_submit($1)`, [s]));
    expect(out.status).toBe("overlap_review");
    expect(out.overlaps[0]?.pun).toBe("BN-HDN-012-01");
    expect(await status(app)).toBe("in_survey");

    await expectError(asUser(db, gis, (tx) => tx.query(`select public.survey_gis_review($1, 'accept')`, [s])), "VALIDATION: still_overlapping");
    // Corrected shape next to (not over) the registered parcel.
    const fixed = square(45.3006, 2.0406, 0.0002);
    const r = await asUser(db, gis, (tx) => scalar<{ status: string }>(tx, `select public.survey_gis_review($1, 'accept', 'Moved east boundary', $2)`, [s, JSON.stringify(fixed)]));
    expect(r.status).toBe("submitted");
    expect(await status(app)).toBe("surveyed");
  });
});

describe("separation of duties", () => {
  it("whoever verified cannot also register", async () => {
    const both = await createStaff(db, admin, "both@gmail.com", ["land_officer", "registrar"], [hodan]);
    const app = await submittedApplication(45.297, 2.037);
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Test')`, [app]));
    const s = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1)`, [app]));
    await asUser(db, surveyor, async (tx) => {
      await tx.query(`select public.survey_save($1, $2)`, [s, JSON.stringify({ geojson: square(45.297, 2.037, 0.0002) })]);
      await tx.query(`select public.survey_submit($1)`, [s]);
    });
    await asUser(db, both, (tx) => tx.query(`select public.application_verify($1, '{"documents_ok":true,"survey_ok":true,"identity_ok":true}')`, [app]));
    await db.query(`update public.public_notices set ends_at = now() - interval '1 minute' where application_id = $1`, [app]);
    await expectError(asUser(db, both, (tx) => tx.query(`select public.application_register($1)`, [app])), "MAKER_CHECKER: verifier");
  });

  it("parcels are visible to district staff and the owner, not to other citizens or the public", async () => {
    const other = await createAuthUser(db, { phone: "+252615550202" });
    expect(await asUser(db, other, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels`), "aal1")).toBe(0);
    expect(await asUser(db, registrar, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where status = 'registered'`))).toBe(2);
    await expect(as(db, "anon", {}, (tx) => tx.query(`select public.parcel_tile(14, 0, 0)`))).rejects.toThrow(/permission denied/);
  });
});
