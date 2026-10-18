import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let desk: string;
let entry: string;
let surveyor: string;
let admin: string;
let hodan: string;
let nbhd: string;
let party: string;

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
  admin = await bootstrapSuperAdmin(db);
  desk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  entry = await createStaff(db, admin, "entry@gmail.com", ["data_entry_clerk"], [hodan]);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Existing Owner', '+252611110000', $1) returning id`, [hodan]);
});

describe("who creates owners and land (0042)", () => {
  const newOwner = () => JSON.stringify({ full_name: "New Person", phone: "+252612345678", district_id: hodan });
  const newLand = () => JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd });

  it("front desk and data entry can't create owners or land", async () => {
    for (const who of [desk, entry]) {
      await expectError(asUser(db, who, (tx) => tx.query(`select public.save_party(null, $1)`, [newOwner()])), "PERMISSION_DENIED");
      await expectError(asUser(db, who, (tx) => tx.query(`select public.application_create($1)`, [newLand()])), "PERMISSION_DENIED");
    }
  });

  it("they can still update an existing owner", async () => {
    await asUser(db, desk, (tx) => tx.query(`select public.save_party($1, $2)`, [party, JSON.stringify({ full_name: "Existing Owner Updated", phone: "+252611110000", district_id: hodan })]));
    expect(await scalar<string>(db, `select full_name from public.parties where id = $1`, [party])).toBe("Existing Owner Updated");
  });

  it("surveyors and admins can create both", async () => {
    for (const who of [surveyor, admin]) {
      expect(await asUser(db, who, (tx) => scalar<string>(tx, `select public.save_party(null, $1)`, [newOwner().replace("New Person", `New ${who.slice(0, 4)}`).replace("+252612345678", `+2526123456${who === admin ? "70" : "71"}`)]))).toBeTruthy();
      const a = await asUser(db, who, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [newLand()]));
      expect(a.id).toBeTruthy();
    }
  });
});
