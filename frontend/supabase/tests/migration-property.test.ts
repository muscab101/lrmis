import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let nbhd: string;
let mig: string;

const call = <T>(sql: string, params: unknown[] = []) => asUser(db, admin, (tx) => scalar<T>(tx, sql, params));
const count = (sql: string, params: unknown[] = []) => scalar<number>(db, `select (${sql})::int`, params);
const landId = (key: string) => scalar<string>(db, `select target_id from public.acct_migration_id_map where migration_id = $1 and entity = 'land' and source_id = $2`, [mig, key]);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('villa_old','Villa','Villa', 0.5) on conflict do nothing`);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('empty_land','Dhul banaan','Empty land', 0) on conflict do nothing`);
  mig = await call<string>(`select public.acct_migration_create($1)`, [JSON.stringify({ name: "Old property system", source_kind: "sql", source_backup_ok: true })]);
  const items = [
    { entity: "owner", source_key: "O1", status: "ready", data: { full_name: "Amina Old Owner", phone: "+252610000001" } },
    { entity: "land", source_key: "H1", status: "ready",
      data: { owner_key: "O1", neighbourhood_id: nbhd, house_no: "14", width: 10, length: 20, property_type: "villa_old", legacy_pun: "OLD-777", lat: 2.04, lon: 45.3 } },
    { entity: "land", source_key: "H2", status: "ready", data: { owner_key: "O1", neighbourhood_id: nbhd, house_no: "15", area: 150, legacy_pun: "OLD-778" } },
    { entity: "land", source_key: "H3", status: "ready", data: { neighbourhood_id: nbhd, house_no: "16", area: 100, demolished: true, demolished_at: "2023-05-01" } },
    { entity: "bill", source_key: "B1", status: "ready", data: { land_key: "H1", fee_code: "property_bill", year: 2023, amount: 100, ref: "T-2023-9" } },
    { entity: "bill", source_key: "B2", status: "ready", data: { land_key: "H1", fee_code: "property_bill", year: 2024, amount: 100 } },
    { entity: "bill", source_key: "B3", status: "ready", data: { land_key: "H3", fee_code: "property_bill", year: 2022, amount: 40 } },
    { entity: "payment", source_key: "P1", status: "ready", data: { land_key: "H1", date: "2024-02-01", amount: 150, method: "cash", payer_phone: "+252610000001" } },
    { entity: "payment", source_key: "P2", status: "ready", data: { bill_key: "B9", date: "2024-02-01", amount: 5 } },
  ];
  await call(`select public.acct_migration_set_items($1, $2, true, $3)`, [mig, JSON.stringify(items), JSON.stringify({ land: 3 })]);
  await call(`select public.acct_migration_backup($1)`, [mig]);
});

describe("migration center: owners, land, bills, payments (0219)", () => {
  it("the test run puts it all back", async () => {
    const r = await call<{ land: number; bills: number; payments: number; failed: number }>(`select public.acct_migration_test($1)`, [mig]);
    expect([r.land, r.bills, r.payments, r.failed]).toEqual([3, 3, 1, 1]);
    expect(await count(`select count(*) from public.parcels`)).toBe(0);
  });

  it("brings land in registered, with new numbers, the old one kept, and its owner", async () => {
    const r = await call<{ owners_created: number; demolished: number; to_check: number }>(`select public.acct_migration_run($1)`, [mig]);
    expect([r.owners_created, r.demolished, r.to_check]).toEqual([1, 1, 2]);
    const h1 = await landId("H1");
    const row = await scalar<{ status: string; pun: string; legacy_ref: string; geom_provisional: boolean; owner: string }>(
      db,
      `select to_jsonb(x) from (select p.status::text, p.pun, p.legacy_ref, p.geom_provisional,
         (select pa.full_name from public.parcel_owners o join public.parties pa on pa.id = o.party_id where o.parcel_id = p.id) as owner
       from public.parcels p where p.id = $1) x`,
      [h1],
    );
    expect(row).toMatchObject({ status: "registered", legacy_ref: "OLD-777", geom_provisional: false, owner: "Amina Old Owner" });
    expect(row.pun).not.toBe("OLD-777");
    // No location: put at the neighbourhood, marked to check.
    const h2 = await landId("H2");
    expect(await scalar<string>(db, `select site_check_status from public.parcels where id = $1 and geom_provisional`, [h2])).toBe("pending");
  });

  it("keeps the bill history; payments go to the oldest bills; nothing sent, nothing in this year's books", async () => {
    const h1 = await landId("H1");
    const bills = await db.query<{ period: string; paid: string; status: string }>(`select period, paid::text, status::text from public.invoices where parcel_id = $1 order by period`, [h1]);
    expect(bills.rows).toEqual([
      { period: "2023", paid: "100.00", status: "paid" },
      { period: "2024", paid: "50.00", status: "partially_paid" },
    ]);
    expect(await count(`select count(*) from public.messages`)).toBe(0);
    expect(await count(`select count(*) from public.journal_entries where source = 'invoice'`)).toBe(0);
    expect(await count(`select count(*) from public.payments where verify_status = 'verified' and receipt_no like 'MIG-%'`)).toBe(1);
  });

  it("land demolished in the old system is demolished here, never standing", async () => {
    const h3 = await landId("H3");
    expect(await scalar<string>(db, `select building_state from public.parcels where id = $1`, [h3])).toBe("demolished");
    expect(await count(`select count(*) from public.demolitions where parcel_id = $1 and status = 'approved'`, [h3])).toBe(1);
  });

  it("undo takes it all back out", async () => {
    await call(`select public.acct_migration_undo($1, 'Wrong neighbourhoods')`, [mig]);
    expect(await count(`select count(*) from public.parcels`)).toBe(0);
    expect(await count(`select count(*) from public.invoices`)).toBe(0);
    expect(await count(`select count(*) from public.payments`)).toBe(0);
    expect(await count(`select count(*) from public.parties where full_name = 'Amina Old Owner'`)).toBe(0);
  });
});
