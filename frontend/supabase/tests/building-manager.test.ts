import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let registrar: string;
let building: string;
let manager: string;

const bill = () =>
  scalar<{ total: string; id: string } | null>(
    db,
    `select row_to_json(x) from (select i.id, i.total from public.invoices i join public.fee_types f on f.id = i.fee_type_id
      where i.parcel_id = $1 and f.code = 'property_bill' and i.status <> 'cancelled' order by i.created_at desc limit 1) x`,
    [building],
  );

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('warehouse','Dhul banaan','Empty Land', 1) on conflict (code) do update set amount = 1, active = true`);
  // A flats building: 20 × 20 m plot, 300 m² footprint → 100 m² open ground at $1 = $100.
  building = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, plot_width_m, plot_length_m, footprint_m2, floors, layout, geom, status, registered_at)
     values ('BN-HDN-012-000300', 'HDN0000300', $1, $2, 'residential', 400, 20, 20, 300, 2, 'flats', extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  await db.query(`select private.building_ground_bill($1)`, [building]);
  manager = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Maamule Cali', '+252611112222', $1) returning id`, [hodan]);
});

describe("apartment building: the manager and the extra areas", () => {
  it("the open ground is billed", async () => {
    expect(Number((await bill())!.total)).toBe(100);
  });

  it("the manager is a person who holds the building as its manager (not as an owner)", async () => {
    await asUser(db, registrar, (tx) => tx.query(`select public.building_manager_set($1, $2)`, [building, manager]));
    const row = await scalar<{ role: string }>(db, `select row_to_json(o) from public.parcel_owners o where parcel_id = $1 and valid_to is null`, [building]);
    expect(row.role).toBe("manager");
    expect(await scalar<string>(db, `select manager_name from public.parcels where id = $1`, [building])).toBe("Maamule Cali");
  });

  it("parking and playgrounds are charged on top of the open ground: m² × the price set for each", async () => {
    await asUser(db, registrar, (tx) => tx.query(`select public.building_area_save(null, $1, $2)`, [building, JSON.stringify({ name: "Parking", area_m2: 50, price_m2: 2 })]));
    expect(Number((await bill())!.total)).toBe(200);
    const play = await asUser(db, registrar, (tx) =>
      scalar<string>(tx, `select public.building_area_save(null, $1, $2)`, [building, JSON.stringify({ name: "Playground", area_m2: 30, price_m2: 1.5 })]),
    );
    expect(Number((await bill())!.total)).toBe(245);
    await asUser(db, registrar, (tx) => tx.query(`select public.building_area_remove($1)`, [play]));
    expect(Number((await bill())!.total)).toBe(200);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.building_area_save(null, $1, $2)`, [building, JSON.stringify({ name: "X", area_m2: 0, price_m2: 1 })])), "VALIDATION");
  });

  it("yearly bills include the extra areas too", async () => {
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const district = await scalar<string>(db, `select district_id from public.parcels where id = $1`, [building]);
    const run = await scalar<Record<string, unknown>>(
      db,
      `select row_to_json(r) from (select gen_random_uuid() id, 2031 as year, '2031' as period, $1::uuid as fee_type_id, array[$2::uuid] as district_ids,
              '{}'::uuid[] as section_ids, '{}'::uuid[] as sector_ids, '{}'::uuid[] as neighbourhood_ids) r`,
      [tax, district],
    );
    const c = await scalar<{ amount: string; lines: { description: string; amount: number }[] }>(
      db,
      `select row_to_json(c) from private.billing_run_candidates_all(jsonb_populate_record(null::public.billing_runs, $1::jsonb)) c where c.parcel_id = $2`,
      [JSON.stringify(run), building],
    );
    expect(Number(c.amount)).toBe(200);
    expect(c.lines.some((l) => l.description.startsWith("Extra areas") && Number(l.amount) === 100)).toBe(true);
  });
});
