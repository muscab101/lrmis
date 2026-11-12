import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// The worked example of "Tax Allocation Apartments": a 600 m² plot (20 × 30 m), a 390 m² footprint on 10 floors
// (3,900 m² built), 3,000 m² of flats of which one is 100 m², and $1.00 per m² for both the flats and the open ground.
let db: PGlite;
let admin: string;
let surveyor: string;
let district: string;
let neighbourhood: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const bill = (parcel: string) =>
  scalar<string | null>(
    db,
    `select i.total::text from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 and f.code = 'property_bill' and i.status <> 'cancelled'`,
    [parcel],
  );
const flat = (land: string, no: string) =>
  db.query<{ id: string; unit_factor: string; area_m2: string; shared_m2: string }>(
    `select id, unit_factor, area_m2, shared_m2 from public.parcels where parent_id = $1 and unit_no = $2`, [land, no]).then((r) => r.rows[0]!);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  neighbourhood = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04))],
  );
  admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [district]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('tower','Dabaq','Tower', 1) on conflict (code) do update set amount = 1`);
  await db.query(`update public.property_grades set amount = 1 where code = 'open_ground'`);
});

const create = (p: Record<string, unknown>) =>
  asUser(db, surveyor, (tx) =>
    scalar<{ parcel_id: string }>(tx, `select public.land_with_units_create($1)`, [
      JSON.stringify({
        district_id: district, neighbourhood_id: neighbourhood, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 20, plot_length_m: 30,
        property_type: "tower", land_use: "residential", layout: "flats", floors: 10,
        units: [
          { unit_no: "01", floor: 1, own_m2: 100, owner_name: "Flat Owner One" },
          { unit_no: "02", floor: 2, own_m2: 2900, owner_name: "Flat Owner Two" },
        ],
        ...p,
      }),
    ]),
  );

describe("apartment tax allocation (dual layer)", () => {
  it("a 100 m² flat of 3,000 m² has unit factor 333.33, is taxed on 130 m² ($130), and the management pays 210 m² ($210)", async () => {
    const r = await create({ footprint_m2: 390, manager_name: "Tower Management", manager_phone: "+252615550111", house_no: "20" });
    const one = await flat(r.parcel_id, "01");
    expect(Number(one.unit_factor)).toBe(333.33);
    expect(Number(one.area_m2)).toBe(130);
    expect(Number(one.shared_m2)).toBe(30);
    expect(Number(await bill(one.id))).toBe(130);
    expect(Number(await bill((await flat(r.parcel_id, "02")).id))).toBe(3770);
    expect(Number(await bill(r.parcel_id))).toBe(210);
  });

  it("without a footprint each flat pays on its own area and there is no ground bill; entering it re-bills them all", async () => {
    const r = await create({ house_no: "21" });
    const one = await flat(r.parcel_id, "01");
    expect(Number(await bill(one.id))).toBe(100);
    expect(await scalar<number>(db, `select count(*)::int from public.invoices where parcel_id = $1`, [r.parcel_id])).toBe(0);
    await asUser(db, admin, (tx) => tx.query(`select public.building_tax_setup($1, $2)`, [r.parcel_id, JSON.stringify({ footprint_m2: 390, manager_name: "Tower Management" })]));
    expect(Number(await bill(one.id))).toBe(130);
    expect(Number(await bill(r.parcel_id))).toBe(210);
    // A footprint bigger than the plot is refused.
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.building_tax_setup($1, $2)`, [r.parcel_id, JSON.stringify({ footprint_m2: 700 })])), "VALIDATION: footprint");
  });

  it("changing a flat's size shares the building out again", async () => {
    const r = await create({ footprint_m2: 390, house_no: "23" });
    const one = await flat(r.parcel_id, "01");
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_update_details($1, $2)`, [one.id, JSON.stringify({ own_m2: 400 })]));
    // 400 of 3,300 m² of flats → unit factor 1212.12, taxable 400 / 3,300 × 3,900 = 472.73 m².
    const after = await flat(r.parcel_id, "01");
    expect(Number(after.unit_factor)).toBe(1212.12);
    expect(Number(after.area_m2)).toBe(472.73);
    expect(Number(await bill(one.id))).toBe(472.73);
  });

  it("yearly bills charge the building for its open ground only", async () => {
    const r = await create({ footprint_m2: 390, house_no: "22" });
    await db.query(`update public.parcels set status = 'registered', registered_at = now() where id = $1 or parent_id = $1`, [r.parcel_id]);
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const run = await scalar<Record<string, unknown>>(
      db,
      `select row_to_json(r) from (select gen_random_uuid() id, 2027 as year, '2027' as period, $1::uuid as fee_type_id, array[$2::uuid] as district_ids,
              '{}'::uuid[] as section_ids, '{}'::uuid[] as sector_ids, '{}'::uuid[] as neighbourhood_ids) r`,
      [tax, district],
    );
    const rows = await db.query<{ parcel_id: string; amount: string }>(
      `select c.parcel_id, c.amount from private.billing_run_candidates_all(jsonb_populate_record(null::public.billing_runs, $1::jsonb)) c where c.parcel_id = $2`,
      [JSON.stringify(run), r.parcel_id],
    );
    expect(Number(rows.rows[0]!.amount)).toBe(210);
  });
});
