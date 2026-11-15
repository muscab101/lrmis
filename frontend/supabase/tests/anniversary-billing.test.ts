import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let parcel: string;
let oldCert: string;
let hodan: string;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return iso(d);
};

beforeAll(async () => {
  db = await createDb();
  const admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('anniv','Darajo','Grade', 0.5) on conflict (code) do update set amount = excluded.amount`);
  // Ali's house: registered, paid, and given a certificate exactly one year ago today.
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, plot_width_m, plot_length_m, property_type, geom, status, registered_at)
     values ('BN-HDN-012-000101', 'HDN0000101', $1, $2, 'residential', 100, 10, 10, 'anniv', extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', $4::date) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001)), yearsAgo(1)],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Ali Xasan', '+252611110001', $1) returning id`, [hodan]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
  await db.query(`update public.parcels set tax_anniversary = $2::date where id = $1`, [parcel, yearsAgo(1)]);
  oldCert = await scalar<string>(
    db,
    `insert into public.issued_documents (type, serial, verify_code, parcel_id, district_id, snapshot, issued_at, expires_at)
     values ('certificate', 'CERT-OLD-1', 'OLDCODE00001', $1, $2, '{}', $3::date, private.next_anniversary($3::date) - interval '1 year') returning id`,
    [parcel, hodan, yearsAgo(1)],
  );
  await db.query(`update public.settings set value = to_jsonb($1::text) where key = 'billing.anniversary_from'`, [yearsAgo(1)]);
});

describe("billing on each property's anniversary", () => {
  it("a certificate lasts until the property's next anniversary", async () => {
    expect(await scalar<string>(db, `select private.next_anniversary($1::date)::text`, [yearsAgo(1)])).toBe(iso(new Date(new Date().setUTCFullYear(new Date().getUTCFullYear() + 1))));
    expect(await scalar<string>(db, `select private.last_anniversary($1::date)::text`, [yearsAgo(1)])).toBe(iso(new Date()));
  });

  it("on the anniversary: the old certificate expires and the year's tax bill is made (once)", async () => {
    const out = await scalar<{ expired: number; runs: number; bills: number }>(db, `select private.billing_anniversary_daily()`);
    expect(out.bills).toBe(1);
    expect(await scalar<string>(db, `select status::text from public.issued_documents where id = $1`, [oldCert])).toBe("expired");
    const bill = await scalar<{ total: string; period: string; status: string }>(
      db,
      `select row_to_json(i) from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 and f.code = 'property_tax'`,
      [parcel],
    );
    expect(Number(bill.total)).toBe(50);
    expect(bill.period).toBe(String(new Date().getUTCFullYear()));
    expect(await scalar<boolean>(db, `select automatic from public.billing_runs where $1 = any (parcel_ids)`, [parcel])).toBe(true);
    // Running again the same day makes nothing new.
    expect((await scalar<{ bills: number }>(db, `select private.billing_anniversary_daily()`)).bills).toBe(0);
  });

  it("paying the new bill gives a new certificate by itself, valid until the next anniversary", async () => {
    const inv = await scalar<string>(db, `select i.id from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 and f.code = 'property_tax'`, [parcel]);
    await db.query(`select private.invoice_apply_payment($1, 50)`, [inv]);
    const cert = await scalar<{ expires_at: string } | null>(
      db,
      `select row_to_json(d) from public.issued_documents d where d.parcel_id = $1 and d.type = 'certificate' and d.status = 'valid'`,
      [parcel],
    );
    expect(cert).not.toBeNull();
    expect(cert!.expires_at.slice(0, 10)).toBe(await scalar<string>(db, `select private.next_anniversary($1::date)::text`, [yearsAgo(1)]));
  });
});

describe("missed yearly bills", () => {
  it("land the automatic billing missed is listed, and a run made for it bills it", async () => {
    const admin = await scalar<string>(db, `select user_id::text from public.profiles where email = 'boss@gmail.com'`);
    const nbhd = await scalar<string>(db, `select id from public.neighbourhoods where code = '012'`);
    const missed = await scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, plot_width_m, plot_length_m, property_type, geom, status, registered_at, tax_anniversary)
       values ('BN-HDN-012-000102', 'HDN0000102', $1, $2, 'residential', 100, 10, 10, 'anniv', extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', $4::date, $4::date) returning id`,
      [hodan, nbhd, JSON.stringify(square(45.31, 2.04, 0.0001)), yearsAgo(2)],
    );
    const list = await asUser(db, admin, (tx) => scalar<{ parcel_id: string; before_automatic: boolean; year: number }[]>(tx, `select public.billing_missed()`));
    // Its anniversary came today, but the daily job has not billed it (as if it had missed the day).
    expect(list.find((x) => x.parcel_id === missed)?.year).toBe(new Date().getUTCFullYear());
    // The parcel billed today by the automatic job is not missed.
    expect(list.some((x) => x.parcel_id === parcel)).toBe(false);
    const runs = await asUser(db, admin, (tx) => scalar<{ id: string; bills: number }[]>(tx, `select public.billing_missed_create($1::uuid[])`, [[missed]]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.bills).toBe(1);
    expect(await scalar<string>(db, `select status::text from public.billing_runs where id = $1`, [runs[0]!.id])).toBe("draft");
    await expect(asUser(db, admin, (tx) => tx.query(`select public.billing_missed_create($1::uuid[])`, [[parcel]]))).rejects.toThrow(/^NOT_FOUND/);
  });
});
