import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let nbhd2: string;

const rows = (sql: string, params: unknown[] = []) =>
  asUser(db, admin, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'39','XW','XW') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'01','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','T','T') returning id`, [section]);
  const nbhd1 = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'N1','N1','N1') returning id`, [sector]);
  nbhd2 = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'N2','N2','N2') returning id`, [sector]);
  const geom = JSON.stringify(square(45.3, 2.04, 0.00004));
  // One unfinished plot first, then 120 newer registered plots (as after the old data came in), one of them owing.
  await db.query(
    `insert into public.parcels (district_id, neighbourhood_id, status, geom, created_at)
     values ($1, $2, 'draft', extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), now() - interval '1 day')`,
    [district, nbhd2, geom],
  );
  await db.query(
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, geom)
     select 'P' || g, 'A' || g, $1, $2, 'registered', now(), extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326)
       from generate_series(1, 120) g`,
    [district, nbhd1, geom],
  );
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  await db.query(
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
     select 'INV-S-1', id, district_id, $1, '2026', current_date, current_date + 60, 25 from public.parcels where pun = 'P7'`,
    [fee],
  );
  await db.query(`insert into public.invoice_lines (invoice_id, kind, description, amount) select id, 'tax', 'Tax', 25 from public.invoices where number = 'INV-S-1'`);
});

describe("Parcels list tabs (0258)", () => {
  it("Partial registration finds unfinished land even behind 100 newer registered plots", async () => {
    expect(await rows(`select status from public.search_parcels('', 100, 'draft')`)).toEqual([{ status: "draft" }]);
  });

  it("the neighbourhood is chosen before the limit too", async () => {
    expect((await rows(`select id from public.search_parcels('', 100, null, $1)`, [nbhd2])).length).toBe(1);
  });

  it("Registered, Not paid and Paid", async () => {
    expect((await rows(`select id from public.search_parcels('', 5000, 'registered')`)).length).toBe(120);
    expect(await rows(`select pun from public.search_parcels('', 100, 'owing')`)).toEqual([{ pun: "P7" }]);
    expect((await rows(`select id from public.search_parcels('', 5000, 'paid')`)).length).toBe(119);
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.parcel_owing_count()::text`))).toBe("1");
  });

  it("the old two-argument call still works", async () => {
    expect((await rows(`select id from public.search_parcels('', 20)`)).length).toBe(20);
  });
});
