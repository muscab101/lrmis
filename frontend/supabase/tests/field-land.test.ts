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
});
