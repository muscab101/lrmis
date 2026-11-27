import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, completeLand, createDb, createStaff, scalar, square } from "./harness";

// Land can't be registered until its details are filled in (0294).
let db: PGlite;
let admin: string;
let surveyor: string;
let hodan: string;
let nbhd: string;

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
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('storey','Dabaq','Storey building', 0.4) on conflict (code) do update set amount = 0.4, active = true`);
});

const land = (extra: Record<string, unknown> = {}) =>
  asUser(db, surveyor, (tx) =>
    scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [
      JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 12, plot_length_m: 12, land_use: "residential", owner_name: "Cabdi Xasan Nuur", ...extra }),
    ]),
  );
const missing = (id: string) => asUser(db, admin, (tx) => scalar<string[]>(tx, `select public.parcel_missing_details($1)`, [id]));

describe("registering needs every detail (0294)", () => {
  it("the land form's owner type is kept (0295)", async () => {
    const type = await scalar<string>(db, `insert into public.owner_types (name_so, name_en) values ('Shirkad Test','Test Company') returning id`);
    const { parcel_id } = await land({ property_type: "storey", house_no: "09", upper_storeys: 1, owner_name: "Shirkadda Nuur", owner_phone: "+252615550555", owner_type_id: type });
    expect(await missing(parcel_id)).toEqual([]);
  });

  it("lists what is missing and refuses to register", async () => {
    const { parcel_id } = await land({ property_type: "storey" });
    expect(await missing(parcel_id)).toEqual(["house_no", "upper_storeys", "owner_phone", "owner_type"]);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [parcel_id]))).rejects.toThrow(
      /^CONFLICT: missing:house_no,upper_storeys,owner_phone,owner_type/,
    );
  });

  it("registers once everything is filled in", async () => {
    const { parcel_id } = await land({ property_type: "storey", house_no: "07", upper_storeys: 2, owner_phone: "+252615550444" });
    expect(await missing(parcel_id)).toEqual(["owner_type"]);
    await completeLand(db);
    expect(await missing(parcel_id)).toEqual([]);
    const r = await asUser(db, admin, (tx) => scalar<{ pun: string }>(tx, `select public.parcel_register($1)`, [parcel_id]));
    expect(r.pun).toBeTruthy();
  });
});
