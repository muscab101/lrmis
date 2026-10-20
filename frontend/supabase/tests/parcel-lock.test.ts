import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

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
  await letClerksCreate(db);
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

describe("parcels table search", () => {
  it("returns English place names too", async () => {
    const r = await asUser(db, admin, (tx) => tx.query<{ district_en: string; neighbourhood_en: string }>(`select district_en, neighbourhood_en from public.search_parcels('BN-HDN-012-000009', 5)`));
    expect(r.rows[0]).toEqual({ district_en: "Hodan", neighbourhood_en: "Taleh" });
  });
});

describe("editing from the table keeps the plot number", () => {
  it("search_parcels returns plot_no", async () => {
    await asUser(db, clerk, (tx) => tx.query(`select public.parcel_update_details($1, '{"house_no":"H-14","plot_no":"P9"}')`, [parcel]));
    const r = await asUser(db, admin, (tx) => tx.query<{ plot_no: string }>(`select plot_no from public.search_parcels('BN-HDN-012-000009', 5)`));
    expect(r.rows[0]!.plot_no).toBe("P9");
  });
});

describe("flat number", () => {
  it("is saved with the parcel details and kept when an edit doesn't send it", async () => {
    await asUser(db, clerk, (tx) => tx.query(`select public.parcel_update_details($1, '{"house_no":"H-14","flat_no":"3B","plot_no":"P9"}')`, [parcel]));
    expect(await scalar<string>(db, `select flat_no from public.parcels where id = $1`, [parcel])).toBe("3B");
    await asUser(db, clerk, (tx) => tx.query(`select public.parcel_update_details($1, '{"house_no":"H-15","plot_no":"P9"}')`, [parcel]));
    expect(await scalar<string>(db, `select flat_no from public.parcels where id = $1`, [parcel])).toBe("3B");
  });

  it("goes from the application to its parcel", async () => {
    const district = await scalar<string>(db, `select district_id from public.parcels where id = $1`, [parcel]);
    const nbhd = await scalar<string>(db, `select neighbourhood_id from public.parcels where id = $1`, [parcel]);
    const app = await scalar<string>(
      db,
      `insert into public.applications (number, type, channel, district_id, neighbourhood_id, flat_no, house_no)
       values ('APP-2026-000901', 'new_registration', 'office', $1, $2, '12', 'H-20') returning id`,
      [district, nbhd],
    );
    const p2 = await scalar<string>(
      db,
      `insert into public.parcels (district_id, neighbourhood_id, land_use, application_id, geom)
       values ($1, $2, 'residential', $3, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326)) returning id`,
      [district, nbhd, app, JSON.stringify(square(45.301, 2.041, 0.0001))],
    );
    expect(await scalar<string>(db, `select flat_no from public.parcels where id = $1`, [p2])).toBe("12");
    await db.query(`update public.applications set parcel_id = $1 where id = $2`, [p2, app]);
    await db.query(`update public.applications set flat_no = '14' where id = $1`, [app]);
    expect(await scalar<string>(db, `select flat_no from public.parcels where id = $1`, [p2])).toBe("14");
  });
});
