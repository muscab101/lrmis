import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let cashier: string;
let karaanCashier: string;
let surveyor: string;
let hodan: string;
let nbhd: string;
let paid: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  const admin = await bootstrapSuperAdmin(db);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  karaanCashier = await createStaff(db, admin, "krn-cashier@gmail.com", ["cashier"], [karaan]);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_bill'`);
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Cali Xasan', '+252615550101') returning id`);
  // Two registered houses (one will be paid) and one draft parcel, each with a bill.
  const parcels: string[] = [];
  for (const [i, status] of [[1, "registered"], [2, "registered"], [3, "draft"]] as const) {
    const id = await scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
       values (case when $5 = 'registered' then 'BNHDN0120' || $1 end, case when $5 = 'registered' then 'HDN000000' || $1 end, $2, $3, '0' || $1, 100,
               extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5::public.parcel_status, case when $5 = 'registered' then now() end) returning id`,
      [String(i), hodan, nbhd, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001)), status],
    );
    if (status === "registered") await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [id, party]);
    parcels.push(id);
    const inv = await scalar<string>(
      db,
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values (private.invoice_number(2026), $1, $2, $3, '2026', current_date + 30, 30) returning id`,
      [id, hodan, fee],
    );
    if (i === 2) paid = inv;
  }
  await db.query(`select private.invoice_apply_payment($1, 30)`, [paid]);
});

describe("cashier: to collect", () => {
  it("lists the unpaid bills of registered land in the cashier's district, with a pay link (partial land is left out, 0298)", async () => {
    const rows = await asUser(db, cashier, (tx) => tx.query<{ pun: string; house_no: string; balance: string; owners: string; pay_path: string }>(`select * from public.cashier_to_collect()`));
    // District cashiers only deal with registered land: house 03 is partial.
    expect(rows.rows.map((r) => r.house_no).sort()).toEqual(["01"]);
    const one = rows.rows.find((r) => r.house_no === "01")!;
    expect(one).toMatchObject({ pun: "BNHDN01201", owners: "Cali Xasan" });
    expect(Number(one.balance)).toBe(30);
    expect(one.pay_path).toMatch(/^\/pay\/[0-9a-f]{64}$/);
  });

  it("another district's cashier sees none; staff without cashier rights are refused", async () => {
    expect((await asUser(db, karaanCashier, (tx) => tx.query(`select * from public.cashier_to_collect()`))).rows).toHaveLength(0);
    await expect(asUser(db, surveyor, (tx) => tx.query(`select * from public.cashier_to_collect()`))).rejects.toThrow(/^PERMISSION_DENIED/);
  });

  it("registering land notifies that district's cashiers (only them) and the house joins To collect", async () => {
    const draft = await scalar<string>(db, `select id from public.parcels where house_no = '03'`);
    await db.query(`update public.parcels set pun = 'BNHDN01203', account_no = 'HDN0000003', status = 'registered', registered_at = now() where id = $1`, [draft]);
    const n = await db.query<{ user_id: string; title_en: string; body_en: string; link: string }>(`select user_id, title_en, body_en, link from public.notifications where kind = 'cashier.to_collect'`);
    expect(n.rows).toEqual([{ user_id: cashier, title_en: "New house to collect from", body_en: "BNHDN01203 · House 03 · Taleh · $30.00 due", link: "/cashier" }]);
    const rows = await asUser(db, cashier, (tx) => tx.query<{ pun: string }>(`select pun from public.cashier_to_collect()`));
    expect(rows.rows.map((r) => r.pun).sort()).toEqual(["BNHDN01201", "BNHDN01203"]);
  });
});
