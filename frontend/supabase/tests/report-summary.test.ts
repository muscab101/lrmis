import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let hodan: string;
let karaan: string;

const summary = (user: string, district: string | null = null, neighbourhood: string | null = null) =>
  asUser(db, user, (tx) =>
    scalar<Record<string, number>>(tx, `select public.report_summary('2026-01-01', '2026-12-31', $1, null, null, $2)`, [district, neighbourhood]),
  );
let hodanN2: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const place = async (code: string) => {
    const d = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,$2,$2,$2) returning id`, [region, code]);
    const s = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'01','S','S') returning id`, [d]);
    const t = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','T','T') returning id`, [s]);
    const n = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,$2,$2,$2) returning id`, [t, code + 'N1']);
    return { d, n };
  };
  const h = await place("HD");
  // A second neighbourhood in Hodan, with one registered house of its own.
  hodanN2 = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en)
     select sector_id, 'HDN2', 'HDN2', 'HDN2' from public.neighbourhoods where id = $1 returning id`,
    [h.n],
  );
  const k = await place("KR");
  hodan = h.d;
  karaan = k.d;
  // Two registered houses in Hodan (one with an owner and a bill), one partial house in Karaan.
  const geom = JSON.stringify(square(45.3, 2.04, 0.0002));
  const land = (d: string, n: string, status: string, pun: string | null) =>
    scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, geom)
       values ($1, $1, $2, $3, $4::public.parcel_status, case when $4 = 'registered' then '2026-03-01'::timestamptz end,
               extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326)) returning id`,
      [pun, d, n, status, geom],
    );
  const p1 = await land(h.d, h.n, "registered", "HD1");
  await land(h.d, h.n, "registered", "HD2");
  await land(k.d, k.n, "draft", null);
  await land(h.d, hodanN2, "registered", "HD3");
  const owner = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Amina Test', '+252610000009') returning id`);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [p1, owner]);
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  await db.query(
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
     values ('INV-T-1', $1, $2, $3, '2026', '2026-03-01', '2026-04-01', 40)`,
    [p1, h.d, fee],
  );
  await db.query(`insert into public.invoice_lines (invoice_id, kind, description, amount) select id, 'tax', 'Tax', 40 from public.invoices where number = 'INV-T-1'`);
});

describe("Reports → Less data (report_summary)", () => {
  it("counts land, owners and bills for every district the viewer covers", async () => {
    const s = await summary(admin);
    expect(s).toMatchObject({ land_registered: 3, land_registered_new: 3, land_partial: 1, owners: 1, bills_issued: 1, billed: 40, outstanding: 40, overdue: 40 });
  });

  it("one neighbourhood only: its land, and the bills of its land", async () => {
    expect(await summary(admin, hodan, hodanN2)).toMatchObject({ land_registered: 1, owners: 0, bills_issued: 0, billed: 0 });
  });

  it("one district only, when chosen", async () => {
    expect(await summary(admin, karaan)).toMatchObject({ land_registered: 0, land_partial: 1, bills_issued: 0 });
  });

  it("staff of one district only see that district", async () => {
    const roleKeys = ["registrar"];
    const staff = await createStaff(db, admin, "registrar.karaan@dhulka.test", roleKeys, [karaan]);
    await db.query(`insert into public.role_permissions (role_id, permission_key) select id, 'reports.view' from public.roles where key = 'registrar' on conflict do nothing`);
    const s = await summary(staff);
    expect(s).toMatchObject({ land_registered: 0, land_partial: 1, billed: 0, outstanding: 0 });
    expect(hodan).toBeTruthy();
  });

  it("needs the reports power", async () => {
    const clerk = await createStaff(db, admin, "clerk.nopower@dhulka.test", ["front_desk_clerk"], [hodan]);
    await expect(summary(clerk)).rejects.toThrow();
  });
});
