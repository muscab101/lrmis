import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let district: string;
let nbhd: string;
let n = 0;

async function newApp(nb = nbhd) {
  n += 1;
  return scalar<string>(
    db,
    `insert into public.applications (number, type, channel, district_id, neighbourhood_id) values ($1, 'new_registration', 'office', $2, $3) returning id`,
    [`APP-2026-0009${String(n).padStart(2, "0")}`, district, nb],
  );
}
const setHouse = (app: string, house: string, type: string | null = null) =>
  asUser(db, admin, (tx) => tx.query(`select public.application_set_details($1, $2, null, $3)`, [app, house, type]));
const taken = (app: string | null = null) =>
  asUser(db, admin, (tx) => tx.query<{ house_no: string; apartment: boolean }>(`select * from public.house_numbers_taken($1, $2) order by 1`, [nbhd, app])).then((r) => r.rows);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const mk = (code: string, lon: number) =>
    scalar<string>(
      db,
      `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
       values ($1, $2, $2, $2, extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326))) returning id`,
      [sector, code, JSON.stringify(square(lon, 2.06, 0.004))],
    );
  nbhd = await mk("001", 45.37);
  await mk("002", 45.38);
  admin = await bootstrapSuperAdmin(db);
});

describe("House No in a neighbourhood", () => {
  it("a number given to one house can't be given to another", async () => {
    const a = await newApp();
    await setHouse(a, "01");
    expect(await taken()).toEqual([{ house_no: "01", apartment: false }]);
    // The application's own number doesn't count against it.
    expect(await taken(a)).toEqual([]);
    await setHouse(a, "01");
    const b = await newApp();
    await expect(setHouse(b, "01")).rejects.toThrow(/^CONFLICT/);
    await setHouse(b, "02");
  });

  it("flats of an apartment block share its House No", async () => {
    const a = await newApp();
    await setHouse(a, "03", "apartment");
    expect((await taken()).find((t) => t.house_no === "03")).toEqual({ house_no: "03", apartment: true });
    const b = await newApp();
    await setHouse(b, "03", "apartment");
    const c = await newApp();
    await expect(setHouse(c, "03", "villa")).rejects.toThrow(/^CONFLICT/);
  });

  it("a cancelled application frees its number, and other neighbourhoods are separate", async () => {
    const a = await newApp();
    await setHouse(a, "04");
    await db.query(`update public.applications set status = 'cancelled' where id = $1`, [a]);
    const b = await newApp();
    await setHouse(b, "04");
    const other = await scalar<string>(db, `select id from public.neighbourhoods where code = '002'`);
    const c = await newApp(other);
    await setHouse(c, "01");
  });
});
