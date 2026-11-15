import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// The owner's apartment rule: a 600 m² plot (20 × 30 m) with three flats of 100 m² (300 m² of flats). Ground-floor
// flats pay the Apartment price ($2 per m² here), upper-floor flats the Upper Floors price ($1), and the manager pays the
// rest of the plot (300 m²) at the Open ground price ($0.50).
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
  db.query<{ id: string; area_m2: string; property_type: string }>(
    `select id, area_m2, property_type from public.parcels where parent_id = $1 and unit_no = $2`, [land, no]).then((r) => r.rows[0]!);

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
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('apartment','Guri dabaq','Apartment', 2) on conflict (code) do update set amount = 2, active = true`);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('upper','Dabaqyada sare','Upper Floors', 1) on conflict (code) do update set amount = 1, active = true`);
  await db.query(`update public.property_grades set amount = 0.5 where code = 'open_ground'`);
});

const create = (p: Record<string, unknown>) =>
  asUser(db, surveyor, (tx) =>
    scalar<{ parcel_id: string }>(tx, `select public.land_with_units_create($1)`, [
      JSON.stringify({
        district_id: district, neighbourhood_id: neighbourhood, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 20, plot_length_m: 30,
        property_type: "tower", land_use: "residential", layout: "flats", floors: 3,
        units: [
          { unit_no: "01", floor: 0, own_m2: 100, owner_name: "Flat Owner One" },
          { unit_no: "02", floor: 1, own_m2: 100, owner_name: "Flat Owner Two" },
          { unit_no: "03", floor: 2, own_m2: 100, owner_name: "Flat Owner Three" },
        ],
        ...p,
      }),
    ]),
  );

describe("apartments: flats by floor, the rest of the plot to the manager", () => {
  it("ground floor at the Apartment price, upper floors at the Upper price, the rest of the plot to the manager", async () => {
    const r = await create({ house_no: "20" });
    const [one, two, three] = [await flat(r.parcel_id, "01"), await flat(r.parcel_id, "02"), await flat(r.parcel_id, "03")];
    expect([one.property_type, two.property_type, three.property_type]).toEqual(["apartment", "upper", "upper"]);
    expect(Number(one.area_m2)).toBe(100);
    expect(Number(await bill(one.id))).toBe(200);
    expect(Number(await bill(two.id))).toBe(100);
    expect(Number(await bill(three.id))).toBe(100);
    expect(Number(await scalar<string>(db, `select footprint_m2::text from public.parcels where id = $1`, [r.parcel_id]))).toBe(300);
    expect(Number(await bill(r.parcel_id))).toBe(150);
  });

  it("the owner entered becomes the manager; a typed name makes a new person", async () => {
    const owner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Building Owner', '+252615550123', $1) returning id`, [district]);
    const r = await create({ house_no: "21", manager_party_id: owner });
    expect(await scalar<string>(db, `select manager_party_id::text from public.parcels where id = $1`, [r.parcel_id])).toBe(owner);
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1 and party_id = $2 and role = 'manager'`, [r.parcel_id, owner])).toBe(1);
    const r2 = await create({ house_no: "24", manager_name: "Typed Manager", manager_phone: "+252615550124" });
    expect(await scalar<string>(db, `select p.full_name from public.parcels b join public.parties p on p.id = b.manager_party_id where b.id = $1`, [r2.parcel_id])).toBe("Typed Manager");
    await expectError(create({ house_no: "25", manager_party_id: "00000000-0000-0000-0000-000000000000" }), "NOT_FOUND: manager");
  });

  it("changing a flat's size or floor bills the building again", async () => {
    const r = await create({ house_no: "23" });
    const one = await flat(r.parcel_id, "01");
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_update_details($1, $2)`, [one.id, JSON.stringify({ own_m2: 200 })]));
    expect(Number(await bill(one.id))).toBe(400);
    // 400 m² of flats now: 200 m² of open ground left × $0.50.
    expect(Number(await bill(r.parcel_id))).toBe(100);
    const two = await flat(r.parcel_id, "02");
    await db.query(`update public.parcels set unit_floor = 0 where id = $1`, [two.id]);
    expect((await flat(r.parcel_id, "02")).property_type).toBe("apartment");
    expect(Number(await bill(two.id))).toBe(200);
  });

  it("yearly bills charge the building for its open ground only", async () => {
    const r = await create({ house_no: "22" });
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
    expect(Number(rows.rows[0]!.amount)).toBe(150);
  });
});
