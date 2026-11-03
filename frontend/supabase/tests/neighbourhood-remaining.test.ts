import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let hodanOfficer: string;
let clerk: string;

type Summary = {
  totals: Record<string, number>;
  districts: { name_en: string; total: number; registered: number; waiting: number; remaining: number }[];
  places: { name_en: string; total: number; registered: number; waiting: number; remaining: number }[];
};
const summary = (user: string) => asUser(db, user, (tx) => scalar<Summary>(tx, `select public.neighbourhood_remaining()`));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const place = async (district: string, code: string, name: string, capacity: number) => {
    const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,$2,'S','S') returning id`, [district, `S${code}`]);
    const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
    return scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en, capacity) values ($1,$2,$3,$3,$4) returning id`, [sector, code, name, capacity]);
  };
  const land = (district: string, nbhd: string, i: number, status: string) =>
    db.query(
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
       values (case when $4 = 'registered' then 'BNHDN' || $1 end, case when $4 = 'registered' then 'HDN' || $1 end, $2, $3, $1, 100,
               extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), $4::public.parcel_status, case when $4 = 'registered' then now() end)`,
      [String(i), district, nbhd, status, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001))],
    );
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const taleh = await place(hodan, "001", "Taleh", 3);
  await place(hodan, "002", "Empty", 10);
  const full = await place(hodan, "003", "Full", 1);
  const away = await place(wadajir, "004", "Away", 5);
  await land(hodan, taleh, 1, "registered");
  await land(hodan, taleh, 2, "draft");
  await land(hodan, full, 3, "registered");
  await land(hodan, full, 4, "registered");
  await land(wadajir, away, 5, "registered");
  hodanOfficer = await createStaff(db, admin, "gis@gmail.com", ["gis_officer"], [hodan]);
  clerk = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  await db.query(`insert into public.role_permissions (role_id, permission_key) select r.id, 'parcels.yet_to_register' from public.roles r where r.key = 'gis_officer' on conflict do nothing`);
  await db.query(`delete from public.role_permissions where permission_key = 'parcels.yet_to_register' and role_id in (select id from public.roles where key = 'cashier')`);
});

describe("land left to register", () => {
  it("adds up total, registered, waiting and remaining; a neighbourhood over its capacity doesn't count below zero", async () => {
    const s = await summary(admin);
    expect(s.totals).toMatchObject({ total: 19, registered: 4, waiting: 1, remaining: 16, neighbourhoods: 4, not_started: 1, waiting_places: 1 });
    expect(s.places.find((p) => p.name_en === "Full")).toMatchObject({ total: 1, registered: 2, remaining: 0 });
    expect(s.places.find((p) => p.name_en === "Taleh")).toMatchObject({ total: 3, registered: 1, waiting: 1, remaining: 2 });
    expect(s.places[0]!.name_en).toBe("Taleh");
    expect(s.places.some((p) => p.name_en === "Empty")).toBe(false);
    expect(s.districts.find((d) => d.name_en === "Hodan")).toMatchObject({ total: 14, registered: 3, waiting: 1, remaining: 12 });
  });

  it("shows only the viewer's districts, and needs the Yet to register permission", async () => {
    const s = await summary(hodanOfficer);
    expect(s.totals).toMatchObject({ total: 14, remaining: 12, neighbourhoods: 3 });
    expect(s.districts.map((d) => d.name_en)).toEqual(["Hodan"]);
    await expect(summary(clerk)).rejects.toThrow(/^PERMISSION_DENIED/);
  });
});
