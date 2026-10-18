import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let surveyor: string;
let otherSurveyor: string;
let clerk: string;
let finance: string;
let landOfficer: string;
let hodan: string;
let nbhd: string;
let app: string;
let survey: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
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
  const admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  otherSurveyor = await createStaff(db, admin, "surveyor2@gmail.com", ["surveyor"], [hodan]);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  landOfficer = await createStaff(db, admin, "land@gmail.com", ["land_officer"], [hodan]);
});

describe("surveyors create owners and land", () => {
  it("a surveyor registers an owner and starts a land parcel with them", async () => {
    const owner = await asUser(db, surveyor, (tx) =>
      scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: "Field Owner", phone: "+252612220000", district_id: hodan })]),
    );
    app = await asUser(db, surveyor, async (tx) => {
      const a = await scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3, pin_lat: 2.04 })]);
      await tx.query(`select public.application_set_parties($1, $2)`, [a.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]);
      await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/id.pdf`]);
      await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'd.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/d.pdf`]);
      await tx.query(`select public.application_submit($1)`, [a.id]);
      return a.id;
    });
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("awaiting_payment");
  });
});

describe("correcting land details during the survey", () => {
  beforeAll(async () => {
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Field test')`, [app]));
    survey = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_assign($1, $2)`, [app, surveyor]));
  });

  it("the assigned surveyor corrects plot, house, receipt and size", async () => {
    await asUser(db, surveyor, (tx) =>
      tx.query(`select public.survey_update_details($1, $2)`, [
        survey,
        JSON.stringify({ plot_no: "P-77", house_no: "H-3", govt_receipt_no: "GR-1", plot_width_m: 15, plot_length_m: 20, address_note: "Behind the school" }),
      ]),
    );
    const a = await scalar<{ plot_no: string; house_no: string; plot_width_m: number }>(db, `select to_jsonb(a) from public.applications a where id = $1`, [app]);
    expect(a.plot_no).toBe("P-77");
    expect(a.house_no).toBe("H-3");
    expect(Number(a.plot_width_m)).toBe(15);
    expect(await scalar<string>(db, `select house_no from public.parcels where application_id = $1`, [app])).toBe("H-3");
    expect(await scalar<number>(db, `select count(*)::int from public.application_events where application_id = $1 and action = 'details_corrected_on_survey'`, [app])).toBe(1);
  });

  it("another surveyor or the front desk can't; a supervisor (surveys.approve) can", async () => {
    await expectError(asUser(db, otherSurveyor, (tx) => tx.query(`select public.survey_update_details($1, '{"plot_no":"X"}')`, [survey])), "PERMISSION_DENIED");
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.survey_update_details($1, '{"plot_no":"X"}')`, [survey])), "(PERMISSION_DENIED|NOT_FOUND)");
    await asUser(db, landOfficer, (tx) => tx.query(`select public.survey_update_details($1, '{"plot_no":"P-78","plot_width_m":15,"plot_length_m":20}')`, [survey]));
    expect(await scalar<string>(db, `select plot_no from public.applications where id = $1`, [app])).toBe("P-78");
  });

  it("rejects a zero plot size", async () => {
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.survey_update_details($1, '{"plot_width_m":0,"plot_length_m":5}')`, [survey])), "VALIDATION");
  });
});

describe("site check (! → ✓)", () => {
  let draft: string;
  beforeAll(async () => {
    draft = await asUser(db, clerk, async (tx) => {
      const a = await scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.301, pin_lat: 2.04 })]);
      return a.id;
    });
  });

  it("the front desk marks ! and the least busy surveyor gets it", async () => {
    const who = await asUser(db, clerk, (tx) => scalar<string>(tx, `select public.application_request_site_check($1, null, 'Check the plot exists')`, [draft]));
    expect([surveyor, otherSurveyor]).toContain(who);
    expect(await scalar<string>(db, `select site_check_status from public.applications where id = $1`, [draft])).toBe("pending");
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'application.site_check'`, [who])).toBe(1);
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.application_request_site_check($1)`, [draft])), "CONFLICT");
  });

  it("only the assigned surveyor (or a supervisor) ticks it; not found needs a note", async () => {
    const assigned = await scalar<string>(db, `select site_check_surveyor from public.applications where id = $1`, [draft]);
    const other = assigned === surveyor ? otherSurveyor : surveyor;
    await expectError(asUser(db, other, (tx) => tx.query(`select public.application_confirm_site($1, true)`, [draft])), "PERMISSION_DENIED");
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.application_confirm_site($1, true)`, [draft])), "PERMISSION_DENIED");
    await expectError(asUser(db, assigned, (tx) => tx.query(`select public.application_confirm_site($1, false, '')`, [draft])), "VALIDATION");
    await asUser(db, assigned, (tx) => tx.query(`select public.application_confirm_site($1, true, 'Walls and gate seen')`, [draft]));
    const r = await scalar<{ site_check_status: string; site_check_done_by: string }>(db, `select to_jsonb(a) from public.applications a where id = $1`, [draft]);
    expect(r.site_check_status).toBe("confirmed");
    expect(r.site_check_done_by).toBe(assigned);
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.application_request_site_check($1)`, [draft])), "CONFLICT");
  });
});
