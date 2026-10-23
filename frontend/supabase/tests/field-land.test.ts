import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let surveyor: string;
let clerk: string;
let printer: string;
let otherSurveyor: string;
let hodan: string;
let nbhd: string;
let parcel: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const land = (extra: Record<string, unknown> = {}) => ({
  district_id: hodan,
  neighbourhood_id: nbhd,
  pin_lon: 45.3,
  pin_lat: 2.04,
  plot_width_m: 12,
  plot_length_m: 10,
  house_no: "7",
  property_type: "villa",
  land_use: "residential",
  owner_name: "Xaawo Cali Nuur",
  owner_phone: "+252615550123",
  ...extra,
});

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
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
  otherSurveyor = await createStaff(db, admin, "surveyor2@gmail.com", ["surveyor"], [karaan]);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  printer = await createStaff(db, admin, "printer@gmail.com", ["print_officer"], [hodan]);
});

describe("field land", () => {
  it("a surveyor adds land: a draft parcel with a provisional plot and its owner", async () => {
    const out = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string; party_id: string }>(tx, `select public.field_land_create($1)`, [land()]));
    parcel = out.parcel_id;
    const p = await scalar<{ status: string; application_id: string | null; geom_provisional: boolean; area_m2: string; house_no: string; pun: string | null }>(
      db,
      `select row_to_json(p) from public.parcels p where id = $1`,
      [parcel],
    );
    expect(p).toMatchObject({ status: "draft", application_id: null, geom_provisional: true, house_no: "7", pun: null });
    expect(Number(p.area_m2)).toBe(120);
    const owner = await scalar<{ full_name: string; phone: string }>(
      db,
      `select row_to_json(x) from (select pa.full_name, pa.phone from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = $1) x`,
      [parcel],
    );
    expect(owner).toEqual({ full_name: "Xaawo Cali Nuur", phone: "+252615550123" });
  });

  it("checks permission, district, pin, plot size and the house number", async () => {
    await expectError(asUser(db, printer, (tx) => tx.query(`select public.field_land_create($1)`, [land({ house_no: "8" })])), "PERMISSION_DENIED");
    await expectError(asUser(db, otherSurveyor, (tx) => tx.query(`select public.field_land_create($1)`, [land({ house_no: "8" })])), "DISTRICT_OUT_OF_SCOPE");
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.field_land_create($1)`, [land({ house_no: "8", pin_lon: 45.4 })])), "VALIDATION: pin_outside_neighbourhood");
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.field_land_create($1)`, [land({ house_no: "8", plot_width_m: null })])), "VALIDATION: plot_size");
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.field_land_create($1)`, [land()])), "CONFLICT: house_no_taken");
    // The new-application form sees it as taken too.
    const taken = await asUser(db, clerk, (tx) => tx.query<{ house_no: string }>(`select * from public.house_numbers_taken($1)`, [nbhd]));
    expect(taken.rows.map((r) => r.house_no)).toContain("7");
  });

  it("starting registration creates a field application around the same parcel and moves the owner onto it", async () => {
    // Only surveyors and admins create land and applications (0042); the front desk doesn't.
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.field_land_start_registration($1)`, [parcel])), "PERMISSION_DENIED");
    const app = await asUser(db, surveyor, (tx) => scalar<{ id: string; number: string }>(tx, `select public.field_land_start_registration($1)`, [parcel]));
    expect(app.number).toMatch(/^APP-\d{4}-\d{6}$/);
    const a = await scalar<{ channel: string; status: string; parcel_id: string; house_no: string; plot_width_m: string; plot_length_m: string; property_type: string }>(
      db,
      `select row_to_json(a) from public.applications a where id = $1`,
      [app.id],
    );
    expect(a).toMatchObject({ channel: "field", status: "draft", parcel_id: parcel, house_no: "7", property_type: "villa" });
    expect([Number(a.plot_width_m), Number(a.plot_length_m)]).toEqual([12, 10]);
    expect(await scalar<string>(db, `select application_id from public.parcels where id = $1`, [parcel])).toBe(app.id);
    expect(await scalar<number>(db, `select count(*)::int from public.application_parties where application_id = $1 and role = 'owner'`, [app.id])).toBe(1);
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1`, [parcel])).toBe(0);
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.field_land_start_registration($1)`, [parcel])), "CONFLICT: already_started");
  });

  it("yet to register: counts waiting and registered land per neighbourhood, in the caller's districts", async () => {
    const sector = await scalar<string>(db, `select sector_id from public.neighbourhoods where id = $1`, [nbhd]);
    await db.query(`insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'013','Bacaad','Bacaad')`, [sector]);
    const rows = await asUser(db, surveyor, (tx) =>
      tx.query<{ code: string; partial: string; open_applications: string; registered: string; has_boundary: boolean }>(`select * from public.neighbourhood_registration_status()`),
    );
    const by = (c: string) => rows.rows.find((r) => r.code === c)!;
    // The field land is now on an application: one partial parcel and one open application.
    expect([by("012").partial, by("012").open_applications, by("012").registered].map(Number)).toEqual([1, 1, 0]);
    expect(by("012").has_boundary).toBe(true);
    expect([by("013").partial, by("013").registered].map(Number)).toEqual([0, 0]);
    expect((await asUser(db, otherSurveyor, (tx) => tx.query(`select * from public.neighbourhood_registration_status()`))).rows).toHaveLength(0);
  });

  it("owners follow their land: not registered on draft land, registered when the land is", async () => {
    const out = await asUser(db, surveyor, (tx) =>
      scalar<{ parcel_id: string; party_id: string }>(tx, `select public.field_land_create($1)`, [land({ house_no: "21", owner_name: "Maryan Cabdi", owner_phone: "+252615550199" })]),
    );
    expect(await scalar<string | null>(db, `select registered_at from public.parties where id = $1`, [out.party_id])).toBeNull();
    await db.query(`update public.parcels set pun = 'BNHDN01299', account_no = 'HDN0000099', status = 'registered', registered_at = now() where id = $1`, [out.parcel_id]);
    expect(await scalar<string | null>(db, `select registered_at from public.parties where id = $1`, [out.party_id])).not.toBeNull();
  });

  it("a surveyor in their zone adds land for an owner entered with the full owner form, and sees the zone's houses", async () => {
    const zoneSurveyor = await createStaff(db, await scalar<string>(db, `select user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'super_admin' limit 1`), "zone.surveyor@gmail.com", ["surveyor"], [hodan]);
    await db.query(`insert into public.survey_zones (neighbourhood_id, district_id, surveyor_id, target) values ($1, $2, $3, 50)`, [nbhd, hodan, zoneSurveyor]);
    // As on the live system: surveyors don't have parcels.view.
    await db.query(`delete from public.role_permissions where permission_key = 'parcels.view' and role_id = (select id from public.roles where key = 'surveyor')`);
    // Houses others recorded in the zone's neighbourhood are visible to the zone's surveyor.
    const seen = await asUser(db, zoneSurveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where neighbourhood_id = $1`, [nbhd]));
    expect(seen).toBeGreaterThan(0);
    const owner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id, id_type, id_number) values ('Cabdi Nuur Xasan', '+252615550777', $1, 'passport', 'P-777') returning id`, [hodan]);
    const out = await asUser(db, zoneSurveyor, (tx) =>
      scalar<{ parcel_id: string; party_id: string }>(tx, `select public.field_land_create($1)`, [land({ house_no: "31", owner_name: null, owner_phone: null, owner_id: owner })]),
    );
    expect(out.party_id).toBe(owner);
    expect(await scalar<string>(db, `select party_id from public.parcel_owners where parcel_id = $1`, [out.parcel_id])).toBe(owner);
    // A surveyor without a zone there sees only the land they recorded themselves.
    const mine = await asUser(db, surveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where id = $1`, [out.parcel_id]));
    expect(mine).toBe(0);
  });
});
