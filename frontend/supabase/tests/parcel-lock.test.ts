import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let registrar: string;
let admin: string;
let clerk: string;
let parcel: string;
let party: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
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
  admin = await bootstrapSuperAdmin(db);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  clerk = await createStaff(db, admin, "entry@gmail.com", ["data_entry_clerk"], [hodan]);
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000009', 'HDN0000009', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Owner One', '+252611111111', $1) returning id`, [hodan]);
});

describe("parcel details and lock", () => {
  it("staff with parcels.update set House No and Govt. Receipt", async () => {
    await asUser(db, clerk, (tx) =>
      tx.query(`select public.parcel_update_details($1, $2)`, [parcel, JSON.stringify({ house_no: "H-12", govt_receipt_no: "GR-5531", plot_no: "P9" })]),
    );
    const r = await scalar<{ house_no: string; govt_receipt_no: string }>(db, `select to_jsonb(p) from public.parcels p where id = $1`, [parcel]);
    expect(r.house_no).toBe("H-12");
    expect(r.govt_receipt_no).toBe("GR-5531");
  });

  it("only parcels.lock can lock, with a reason", async () => {
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.parcel_lock($1, 'Court order 12')`, [parcel])), "PERMISSION_DENIED");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_lock($1, '')`, [parcel])), "VALIDATION");
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_lock($1, 'Court order 12')`, [parcel]));
    expect(await scalar<string>(db, `select lock_reason from public.parcels where id = $1`, [parcel])).toBe("Court order 12");
  });

  it("a locked parcel can't be edited, re-shaped or get new owners", async () => {
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.parcel_update_details($1, '{"house_no":"X"}')`, [parcel])), "PARCEL_LOCKED");
    await expectError(db.query(`update public.parcels set land_use = 'commercial' where id = $1`, [parcel]), "PARCEL_LOCKED");
    await expectError(db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]), "PARCEL_LOCKED");
  });

  it("invoices still work on a locked parcel", async () => {
    const fee = await scalar<string>(db, `select id from public.fee_types where code = 'certificate_fee'`);
    const district = await scalar<string>(db, `select district_id from public.parcels where id = $1`, [parcel]);
    await db.query(`insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('INV-2026-000777', $1, $2, $3, 'x', current_date + 30, 20)`, [parcel, district, fee]);
    // Admin sees invoices (the Registrar role doesn't).
    const row = await asUser(db, admin, (tx) => tx.query<{ invoice: string; locked_at: string | null }>(`select invoice, locked_at from public.search_parcels('GR-5531', 10)`));
    expect(row.rows[0]!.invoice).toBe("INV-2026-000777");
    expect(row.rows[0]!.locked_at).not.toBeNull();
  });

  it("unlocking needs a reason and opens it again", async () => {
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.parcel_unlock($1, 'no')`, [parcel])), "VALIDATION");
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_unlock($1, 'Order lifted')`, [parcel]));
    await asUser(db, clerk, (tx) => tx.query(`select public.parcel_update_details($1, '{"house_no":"H-14"}')`, [parcel]));
    expect(await scalar<string>(db, `select house_no from public.parcels where id = $1`, [parcel])).toBe("H-14");
    const actions = (await db.query<{ action: string }>(`select action from public.parcel_history where parcel_id = $1 order by id`, [parcel])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["locked", "unlocked", "details_updated"]));
  });
});
