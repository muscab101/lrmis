import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let landOfficer: string;
let surveyor: string;
let surveyor2: string;
let karaanSurveyor: string;
let hodan: string;
let nbhd: string;
let zone: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, capacity, geom)
     values ($1,'012','Taleex','Taleh', 50, extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  const admin = await bootstrapSuperAdmin(db);
  landOfficer = await createStaff(db, admin, "land@gmail.com", ["land_officer"], [hodan]);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  surveyor2 = await createStaff(db, admin, "surveyor2@gmail.com", ["surveyor"], [hodan]);
  karaanSurveyor = await createStaff(db, admin, "krn@gmail.com", ["surveyor"], [karaan]);
});

describe("survey zones", () => {
  it("lists the district's surveyors for assigning", async () => {
    const rows = await asUser(db, landOfficer, (tx) => tx.query<{ user_id: string }>(`select * from public.district_surveyors($1)`, [hodan]));
    expect(rows.rows.map((r) => r.user_id).sort()).toEqual([surveyor, surveyor2].sort());
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select * from public.district_surveyors($1)`, [hodan])), "PERMISSION_DENIED");
  });

  it("assigns a neighbourhood with its capacity as the target; one open zone per neighbourhood", async () => {
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.survey_zone_assign($1, $2, null)`, [nbhd, surveyor])), "PERMISSION_DENIED");
    await expectError(asUser(db, landOfficer, (tx) => tx.query(`select public.survey_zone_assign($1, $2, null)`, [nbhd, karaanSurveyor])), "VALIDATION: surveyor");
    const empty = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) select sector_id, '099', 'X', 'X' from public.neighbourhoods where id = $1 returning id`, [nbhd]);
    await expectError(asUser(db, landOfficer, (tx) => tx.query(`select public.survey_zone_assign($1, $2, null)`, [empty, surveyor])), "VALIDATION: target");
    zone = await asUser(db, landOfficer, (tx) => scalar<string>(tx, `select public.survey_zone_assign($1, $2, null, 'Start from the market')`, [nbhd, surveyor]));
    expect(await scalar<number>(db, `select target from public.survey_zones where id = $1`, [zone])).toBe(50);
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'survey_zone.assigned'`, [surveyor])).toBe(1);
    await expectError(asUser(db, landOfficer, (tx) => tx.query(`select public.survey_zone_assign($1, $2, 10)`, [nbhd, surveyor2])), "CONFLICT: zone_open");
  });

  it("the surveyor sees the zone and its progress as land is added there", async () => {
    await asUser(db, surveyor, (tx) =>
      tx.query(`select public.field_land_create($1)`, [
        { district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 10, plot_length_m: 10, house_no: "1", owner_name: "Cali Xasan" },
      ]),
    );
    const mine = await asUser(db, surveyor, (tx) => tx.query<{ id: string; target: number; recorded: string; partial: string }>(`select * from public.survey_zone_list(true)`));
    expect(mine.rows).toHaveLength(1);
    // 1 house of the neighbourhood's 50.
    expect([mine.rows[0]!.target, Number(mine.rows[0]!.recorded), Number(mine.rows[0]!.partial)]).toEqual([50, 1, 1]);
    expect((await asUser(db, surveyor2, (tx) => tx.query(`select * from public.survey_zone_list(true)`))).rows).toHaveLength(0);
    expect((await asUser(db, landOfficer, (tx) => tx.query(`select * from public.survey_zone_list(false)`))).rows).toHaveLength(1);
  });

  it("the surveyor marks it done; only officers cancel", async () => {
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.survey_zone_close($1, 'cancelled')`, [zone])), "PERMISSION_DENIED");
    await expectError(asUser(db, surveyor2, (tx) => tx.query(`select public.survey_zone_close($1, 'done')`, [zone])), "NOT_FOUND");
    await asUser(db, surveyor, (tx) => tx.query(`select public.survey_zone_close($1, 'done')`, [zone]));
    expect(await scalar<string>(db, `select status from public.survey_zones where id = $1`, [zone])).toBe("done");
    // Done frees the neighbourhood for a new zone.
    await asUser(db, landOfficer, (tx) => tx.query(`select public.survey_zone_assign($1, $2, 20)`, [nbhd, surveyor2]));
  });
});
