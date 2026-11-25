import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// Deleted items (0287): one list of what was deleted, Restore, and removal for good after 3 months
// (never land with money on it).
let db: PGlite;
let admin: string;
let hodan: string;
let nbhd: string;

const land = (house: string) =>
  scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
     values ($1, $1, $2, $3, $1, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), 'registered', now()) returning id`,
    [house, hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
const del = (id: string) => asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'Entered by mistake')`, [id]));
const items = () => asUser(db, admin, (tx) => tx.query<{ kind: string; id: string; kept: boolean; reason: string }>(`select * from public.deleted_items()`)).then((r) => r.rows);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','Taleex','Taleh') returning id`, [sector]);
  admin = await bootstrapSuperAdmin(db);
});

describe("deleted items (0287)", () => {
  it("lists deleted land and owners with the reason; staff without the power can't see it", async () => {
    const a = await land("D001");
    await del(a);
    const owner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Old Owner', '+252615559911', $1) returning id`, [hodan]);
    await asUser(db, admin, (tx) => tx.query(`select public.party_delete($1, 'Entered twice')`, [owner]));
    const rows = await items();
    expect(rows.find((r) => r.id === a)).toMatchObject({ kind: "land", reason: "Entered by mistake", kept: false });
    expect(rows.find((r) => r.id === owner)?.kind).toBe("owner");
    const clerk = await createStaff(db, admin, "clerk@gmail.com", ["data_entry_clerk"], [hodan]);
    await expect(asUser(db, clerk, (tx) => tx.query(`select * from public.deleted_items()`))).rejects.toThrow(/^PERMISSION_DENIED/);
  });

  it("restore brings land back with the bills its deletion cancelled", async () => {
    const b = await land("D002");
    const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_bill'`);
    const bill = await scalar<string>(db, `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('INV-D2', $1, $2, $3, '2026', current_date + 30, 20) returning id`, [b, hodan, fee]);
    await del(b);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [bill])).toBe("cancelled");
    await asUser(db, admin, (tx) => tx.query(`select public.deleted_restore('land', $1)`, [b]));
    expect(await scalar<boolean>(db, `select deleted_at is null from public.parcels where id = $1`, [b])).toBe(true);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [bill])).toBe("issued");
  });

  it("after 3 months: removed for good, except land with money on it", async () => {
    const plain = await land("D003");
    const paid = await land("D004");
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const inv = await scalar<string>(db, `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('INV-D4', $1, $2, $3, '2026', current_date + 30, 40) returning id`, [paid, hodan, tax]);
    await db.query(`select private.record_payment(jsonb_build_object('parcel_id', $1::text, 'invoice_id', $2::text, 'method', 'cash', 'amount', 10))`, [paid, inv]);
    await del(plain);
    await del(paid);
    await db.query(`update public.parcels set deleted_at = now() - interval '91 days' where id = any ($1::uuid[])`, [[plain, paid]]);
    const out = await scalar<{ land: number }>(db, `select private.purge_deleted()`);
    expect(Number(out.land)).toBeGreaterThanOrEqual(1);
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where id = $1`, [plain])).toBe(0);
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where id = $1`, [paid])).toBe(1);
    expect((await items()).find((r) => r.id === paid)?.kept).toBe(true);
  });
});
