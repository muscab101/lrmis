import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let district: string;
let guessed: string;
let other: string;

const remap = (user: string, id: string, geom: object, reason = "Placed at the real plot after the visit") =>
  asUser(db, user, (tx) => scalar<Record<string, number>>(tx, `select public.parcel_remap($1, $2, $3)`, [id, JSON.stringify(geom), reason]));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'39','XW','XW') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'01','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','T','T') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'XWKCAA02','N','N') returning id`, [sector]);
  const land = (pun: string, lon: number, provisional: boolean) =>
    scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, area_m2, plot_width_m, plot_length_m,
                                   geom, geom_provisional, site_check_status, site_check_requested_at)
       values ($1, $1, $2, $3, 'registered', now(), 56, 7, 8, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5,
               case when $5 then 'pending' end, case when $5 then now() end) returning id`,
      [pun, district, nbhd, JSON.stringify(square(lon, 2.04, 0.00004)), provisional],
    );
  // An old plot placed by guess, and a properly drawn plot 200 m east of it.
  guessed = await land("391121", 45.3, true);
  other = await land("391122", 45.3018, false);
  // Another guessed square, right where the real place of the first one is: it must not block the remap.
  await land("391123", 45.305, true);
});

describe("Remap (0257)", () => {
  it("puts land placed by guess where it really is, keeps its size, ticks its site check and keeps the old place", async () => {
    const out = await remap(admin, guessed, square(45.305, 2.04, 0.00004));
    expect(out.moved_m).toBeGreaterThan(500);
    const p = await scalar<Record<string, unknown>>(
      db,
      `select to_jsonb(x) from (select geom_provisional, site_check_status, area_m2::float8 as area_m2,
         round(extensions.st_x(extensions.st_centroid(geom))::numeric, 4)::float8 as lon,
         (select action from public.parcel_history h where h.parcel_id = p.id order by h.at desc limit 1) as last
         from public.parcels p where id = $1) x`,
      [guessed],
    );
    expect(p).toMatchObject({ geom_provisional: false, site_check_status: "confirmed", area_m2: 56, lon: 45.305, last: "remapped" });
  });

  it("refuses a place that overlaps land drawn for real", async () => {
    await expect(remap(admin, guessed, square(45.3018, 2.04, 0.00004))).rejects.toThrow(/still_overlapping|VALIDATION/);
    expect(other).toBeTruthy();
  });

  it("needs a reason and a real shape", async () => {
    await expect(remap(admin, guessed, square(45.307, 2.04, 0.00004), "x")).rejects.toThrow(/VALIDATION/);
    await expect(remap(admin, guessed, square(45.307, 2.04, 0.000001))).rejects.toThrow(/VALIDATION/);
  });

  it("only staff who capture locations and may change land", async () => {
    const clerk = await createStaff(db, admin, "clerk.remap@dhulka.test", ["front_desk_clerk"], [district]);
    await expect(remap(clerk, guessed, square(45.307, 2.04, 0.00004))).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("not locked land", async () => {
    await db.query(`update public.parcels set locked_at = now(), lock_reason = 'Court case' where id = $1`, [other]);
    await expect(remap(admin, other, square(45.309, 2.04, 0.00004))).rejects.toThrow(/PARCEL_LOCKED/);
  });
});
