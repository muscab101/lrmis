import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let entry: string;
let desk: string;
let registrar: string;
let registrar2: string;
let hodan: string;
let nbhd: string;
let parcel: string;

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
  entry = await createStaff(db, admin, "entry@gmail.com", ["data_entry_clerk"], [hodan]);
  desk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  registrar = await createStaff(db, admin, "reg@gmail.com", ["registrar"], [hodan]);
  registrar2 = await createStaff(db, admin, "reg2@gmail.com", ["registrar"], [hodan]);
  // A desk role without the capture permission, to prove the check.
  await db.query(`delete from public.role_permissions where permission_key = 'applications.capture_location' and role_id = (select id from public.roles where key = 'front_desk_clerk')`);
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at, deed_no)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now(), 'OLD-1') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  await db.query(
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, area_m2, geom, status, registered_at) values ('BN-HDN-012-000002', 'HDN0000002', $1, $2, 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now())`,
    [hodan, nbhd, JSON.stringify(square(45.3004, 2.04, 0.0001))],
  );
});

describe("location capture in registration", () => {
  it("records who captured the pin and when, and flags low GPS accuracy", async () => {
    const app = await asUser(db, entry, (tx) =>
      scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, pin_lon: 45.3001, pin_lat: 2.0401, pin_accuracy_m: 32 })]),
    );
    await asUser(db, entry, (tx) => tx.query(`select public.application_location_meta($1, 'gps', 20, 25)`, [app.id]));
    const a = await scalar<{ pin_captured_by: string; pin_captured_at: string; pin_low_accuracy: boolean; pin_method: string; plot_width_m: string }>(db, `select row_to_json(a) from public.applications a where id = $1`, [app.id]);
    expect(a.pin_captured_by).toBe(entry);
    expect(a.pin_captured_at).not.toBeNull();
    expect(a.pin_method).toBe("gps");
    expect(a.pin_low_accuracy).toBe(true);
    // Dragged by hand: no accuracy, not low accuracy, declared area kept.
    const meta = await asUser(db, entry, (tx) => scalar<{ pin_low_accuracy: boolean; declared_area_m2: string }>(tx, `select public.application_location_meta($1, 'manual', 20, 25)`, [app.id]));
    expect(meta.pin_low_accuracy).toBe(false);
    expect(Number(meta.declared_area_m2)).toBe(500);
    expect(await scalar<string | null>(db, `select pin_accuracy_m from public.applications where id = $1`, [app.id])).toBeNull();
  });

  it("staff without the capture-location permission can't set a pin", async () => {
    await expectError(
      asUser(db, desk, (tx) => tx.query(`select public.application_create($1)`, [JSON.stringify({ district_id: hodan, pin_lon: 45.3001, pin_lat: 2.0401 })])),
      "PERMISSION_DENIED: capture_location",
    );
    const ok = await asUser(db, desk, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan })]));
    expect(ok.id).toBeTruthy();
  });
});

describe("data correction after registration", () => {
  it("needs a second approver; fields and boundary change, area is recomputed, the change is logged", async () => {
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_change_request('correction', $1, '{}', 'Typo in the deed number')`, [[parcel]])), "VALIDATION: correction_empty");
    await expectError(
      asUser(db, registrar, (tx) => tx.query(`select public.parcel_change_request('correction', $1, $2, 'Boundary drawn over the neighbour')`, [[parcel], JSON.stringify({ geom: square(45.3002, 2.04, 0.0003) })])),
      "VALIDATION: still_overlapping",
    );
    const geom = square(45.3, 2.04, 0.00012);
    const id = await asUser(db, registrar, (tx) =>
      scalar<string>(tx, `select public.parcel_change_request('correction', $1, $2, 'Deed number mistyped; boundary re-walked')`, [[parcel], JSON.stringify({ deed_no: "D-2020-55", geom })]),
    );
    await asUser(db, registrar2, (tx) => tx.query(`select public.parcel_change_decide($1, true, 'Checked on site')`, [id]));
    const p = await scalar<{ deed_no: string; area_m2: string }>(db, `select row_to_json(p) from public.parcels p where id = $1`, [parcel]);
    expect(p.deed_no).toBe("D-2020-55");
    expect(Number(p.area_m2)).toBeGreaterThan(500);
    const ev = await scalar<{ data: { old: { deed_no: string } } }>(db, `select row_to_json(h) from public.parcel_history h where parcel_id = $1 and action = 'corrected'`, [parcel]);
    expect(ev.data.old.deed_no).toBe("OLD-1");
  });
});

describe("nearby check while entering a location", () => {
  it("finds a registered parcel under the pin; nothing far away", async () => {
    const near = await asUser(db, entry, (tx) => scalar<{ count: number; parcels: { pun: string }[] }>(tx, `select public.pin_nearby(45.3, 2.04, null, 10)`));
    expect(near.count).toBeGreaterThanOrEqual(1);
    expect(near.parcels.map((p) => p.pun)).toContain("BN-HDN-012-000001");
    const far = await asUser(db, entry, (tx) => scalar<{ count: number }>(tx, `select public.pin_nearby(45.31, 2.05, null, 10)`));
    expect(far.count).toBe(0);
  });
});
