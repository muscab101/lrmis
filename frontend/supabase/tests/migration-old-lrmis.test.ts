import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, scalar } from "./harness";

let db: PGlite;
let admin: string;
let mig: string;

const call = <T>(sql: string, params: unknown[] = []) => asUser(db, admin, (tx) => scalar<T>(tx, sql, params));
const count = (sql: string, params: unknown[] = []) => scalar<number>(db, `select (${sql})::int`, params);
const land = (key: string) =>
  scalar<string>(db, `select target_id from public.acct_migration_id_map where migration_id = $1 and entity = 'land' and source_id = $2`, [mig, key]);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'39','Xamar-Weyne','Xamar-Weyne') returning id`, [region]);
  // As on the live database today: the section has a map point, the neighbourhood has no boundary.
  const section = await scalar<string>(
    db,
    `insert into public.sections (district_id, code, name_so, name_en, point) values ($1,'01','Kacaan','Kacaan', extensions.st_setsrid(extensions.st_makepoint(45.339, 2.0364), 4326)) returning id`,
    [district],
  );
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','AA','AA') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'XWKCAA02','XWKCAA02','XWKCAA02') returning id`, [sector]);
  mig = await call<string>(`select public.acct_migration_create($1)`, [JSON.stringify({ name: "Old LRMIS", source_kind: "sql", source_backup_ok: true })]);
  const items = [
    { entity: "owner", source_key: "O-1", status: "ready",
      data: { full_name: "Suufi Xaaji Shiiqow", phone: "+252615868858", nationality: "SO", id_number: "WAG/179", email: "suufi@hotmail.com", address: "Xamar-Weyne",
              next_of_kin: { name: "Caasho Cumar", phone: "+252616129863" } } },
    { entity: "land", source_key: "L-1", status: "ready",
      data: { owner_key: "O-1", neighbourhood_id: nbhd, house_no: "12", plot_no: "KCAA0212", width: 7, length: 8, property_type: "villa", ownership: "private",
              developed: true, deed_no: "249550", govt_file_no: "F-9", registered_at: "2015-09-09", legacy_account: "39622085001",
              old: { street: "AW AWEYSKA" } } },
    { entity: "bill", source_key: "B-1", status: "ready",
      data: { land_key: "L-1", fee_code: "property_bill", year: 2015, amount: 9.74, issue_date: "2015-09-09", due_date: "2015-09-09", ref: "IN-1", note: "Old bill IN-1: 224,000 SOS at 23000" } },
    { entity: "payment", source_key: "P-1", status: "ready",
      data: { land_key: "L-1", date: "2015-09-15", amount: 9.74, method: "cash", ref: "PA-1", note: "Old payment PA-1" } },
  ];
  await call(`select public.acct_migration_set_items($1, $2, true, $3)`, [mig, JSON.stringify(items), JSON.stringify({ land: { ready: 1 } })]);
  await call(`select public.acct_migration_backup($1)`, [mig]);
  await call(`select public.acct_migration_test($1)`, [mig]);
  await call(`select public.acct_migration_run($1)`, [mig]);
});

describe("old LRMIS migration (0253)", () => {
  it("places land with no boundary or GPS near its section's point, to be checked", async () => {
    const id = await land("L-1");
    const p = await scalar<{ provisional: boolean; check: string; metres: number; anniversary: string }>(
      db,
      `select to_jsonb(x) from (select p.geom_provisional as provisional, p.site_check_status as check, p.tax_anniversary::text as anniversary,
         round(extensions.st_distance(p.centroid::extensions.geography, extensions.st_setsrid(extensions.st_makepoint(45.339, 2.0364), 4326)::extensions.geography))::int as metres
         from public.parcels p where p.id = $1) x`,
      [id],
    );
    expect(p).toMatchObject({ provisional: true, check: "pending", anniversary: "2015-09-09" });
    expect(p.metres).toBeLessThan(200);
  });

  it("keeps the old owner and land details", async () => {
    const id = await land("L-1");
    const row = await scalar<Record<string, unknown>>(
      db,
      `select to_jsonb(x) from (select p.plot_no, p.house_no, p.deed_no, p.govt_file_no, p.ownership::text, p.developed, p.legacy_ref,
         a.nationality, a.id_number, a.email, a.address, a.next_of_kin
         from public.parcels p join public.parcel_owners o on o.parcel_id = p.id join public.parties a on a.id = o.party_id where p.id = $1) x`,
      [id],
    );
    expect(row).toMatchObject({
      plot_no: "KCAA0212", house_no: "12", deed_no: "249550", govt_file_no: "F-9", ownership: "private", developed: true, legacy_ref: "39622085001",
      nationality: "SO", id_number: "WAG/179", email: "suufi@hotmail.com", address: "Xamar-Weyne", next_of_kin: { name: "Caasho Cumar", phone: "+252616129863" },
    });
  });

  it("paying old bills issues no certificate, ID card or message", async () => {
    expect(await scalar<string>(db, `select status::text from public.invoices where parcel_id = $1`, [await land("L-1")])).toBe("paid");
    expect(await count(`select count(*) from public.issued_documents`)).toBe(0);
    expect(await count(`select count(*) from public.messages`)).toBe(0);
    expect(await count(`select count(*) from public.notifications`)).toBe(0);
  });

  it("can still be undone", async () => {
    await call(`select public.acct_migration_undo($1, 'Check the undo')`, [mig]);
    expect(await count(`select count(*) from public.parcels`)).toBe(0);
    expect(await count(`select count(*) from public.parties`)).toBe(0);
  });
});
