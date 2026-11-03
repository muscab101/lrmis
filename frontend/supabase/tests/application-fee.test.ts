import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let clerk: string;
let cashier: string;
let finance: string;
let hodan: string;
let nbhd: string;
let shift: string;

/** Front desk submits a complete application (plot 20 m × 20 m declared). */
async function submitted(lon: number): Promise<string> {
  const owner = await asUser(db, clerk, (tx) =>
    scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: `Owner ${lon}`, phone: "+252611234567", district_id: hodan })]),
  );
  const app = await asUser(db, clerk, (tx) =>
    scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: lon, pin_lat: 2.04 })]),
  );
  await db.query(`update public.applications set plot_width_m = 20, plot_length_m = 20 where id = $1`, [app.id]);
  await asUser(db, clerk, async (tx) => {
    await tx.query(`select public.application_set_parties($1, $2)`, [app.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]);
    await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 10)`, [app.id, `${app.id}/id.pdf`]);
    await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'd.pdf', 'application/pdf', 10)`, [app.id, `${app.id}/d.pdf`]);
    await tx.query(`select public.application_submit($1)`, [app.id]);
  });
  return app.id;
}

const feeInvoice = (app: string) =>
  db
    .query<{ id: string; number: string; total: string; status: string; parcel_id: string; provisional: boolean; parcel_status: string }>(
      `select i.id, i.number, i.total::text, i.status::text, i.parcel_id, p.geom_provisional as provisional, p.status::text as parcel_status
         from public.invoices i join public.fee_types f on f.id = i.fee_type_id and f.code = 'service_charge'
         join public.parcels p on p.id = i.parcel_id
        where p.application_id = $1`,
      [app],
    )
    .then((r) => r.rows);
const status = (id: string) => scalar<string>(db, `select status::text from public.applications where id = $1`, [id]);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  const admin = await bootstrapSuperAdmin(db);
  // As set live on Valuation → Fee types: a USD 12 service charge for a new house.
  await db.query(`update public.fee_types set amount = 12 where code = 'service_charge'`);
  clerk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  finance = await createStaff(db, admin, "finance@gmail.com", ["finance_manager"], "all");
  const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
  shift = await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
});

describe("application fee invoice", () => {
  it("submitting raises the $12 registration fee invoice on a provisional draft parcel around the pin", async () => {
    const app = await submitted(45.3);
    expect(await status(app)).toBe("in_survey"); // straight to review; paid later
    const [inv] = await feeInvoice(app);
    expect(inv).toBeDefined();
    expect(Number(inv!.total)).toBe(12);
    expect(inv!.provisional).toBe(true);
    expect(inv!.parcel_status).toBe("draft");
    // The provisional square is sized from the declared 20 m × 20 m plot.
    const area = await scalar<number>(db, `select extensions.st_area(geom::extensions.geography) from public.parcels where id = $1`, [inv!.parcel_id]);
    expect(area).toBeGreaterThan(300);
    expect(area).toBeLessThan(500);
    // A pay link exists for the citizen.
    expect(await scalar<number>(db, `select count(*)::int from public.invoice_tokens where invoice_id = $1`, [inv!.id])).toBe(1);
  });

  it("the cashier takes the fee: part-paid stays due, paid in full settles it", async () => {
    const app = await submitted(45.301);
    const [inv] = await feeInvoice(app);
    const pay5 = () =>
      asUser(db, cashier, (tx) =>
        tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: inv!.parcel_id, invoice_id: inv!.id, amount: 5, method: "cash" })]),
      );
    // The land isn't registered yet, so its bill waits.
    await expect(pay5()).rejects.toThrow(/^CONFLICT: bill_needs_registered/);
    await db.query(`update public.parcels set status = 'registered', registered_at = now(), pun = coalesce(pun, 'FEE' || left(id::text, 8)), account_no = coalesce(account_no, left(id::text, 8)) where id = $1`, [inv!.parcel_id]);
    await pay5();
    expect(await scalar<string>(db, `select fee_status::text from public.applications where id = $1`, [app])).toBe("due"); // part-paid
    await asUser(db, cashier, (tx) =>
      tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: inv!.parcel_id, invoice_id: inv!.id, amount: 7, method: "cash" })]),
    );
    expect(await status(app)).toBe("in_survey");
    expect(await scalar<string>(db, `select fee_status::text from public.applications where id = $1`, [app])).toBe("paid");
    expect((await feeInvoice(app))[0]!.status).toBe("paid");
  });

  it("a waiver cancels the unpaid invoice; cancelling an application archives its provisional parcel", async () => {
    const waived = await submitted(45.302);
    await asUser(db, finance, (tx) => tx.query(`select public.application_waive_fee($1, 'Mosque')`, [waived]));
    expect(await status(waived)).toBe("in_survey");
    expect((await feeInvoice(waived))[0]!.status).toBe("cancelled");

    const dropped = await submitted(45.303);
    await asUser(db, clerk, (tx) => tx.query(`select public.application_transition($1, 'cancel', 'Applicant withdrew')`, [dropped]));
    const [inv] = await feeInvoice(dropped);
    expect(inv!.status).toBe("cancelled");
    expect(inv!.parcel_status).toBe("archived");
  });

  it("provisional shapes are left off the map tiles", async () => {
    const tiles = await scalar<number>(
      db,
      `select count(*)::int from public.parcels where geom_provisional and status <> 'archived'`,
    );
    expect(tiles).toBeGreaterThan(0);
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'parcel_tile'`);
    expect(src).toContain("not p.geom_provisional");
  });
});

describe("application fee for the application page", () => {
  it("staff in the district see the invoice and its pay link; other districts don't", async () => {
    const app = await submitted(45.2995);
    const fee = await asUser(db, clerk, (tx) => scalar<{ number: string; balance: number; pay_link: string } | null>(tx, `select public.application_fee($1)`, [app]));
    expect(Number(fee!.balance)).toBe(12);
    expect(fee!.pay_link).toMatch(/^\/pay\//);
    const region = await scalar<string>(db, `select region_id from public.districts where id = $1`, [hodan]);
    const wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
    const boss = await scalar<string>(db, `select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'super_admin' limit 1`);
    const outsider = await createStaff(db, boss, "desk.other@gmail.com", ["front_desk_clerk"], [wadajir]);
    expect(await asUser(db, outsider, (tx) => scalar(tx, `select public.application_fee($1)`, [app]))).toBeNull();
  });
});

describe("deleting an application (0058)", () => {
  const count = (sql: string, args: unknown[]) => scalar<number>(db, `select count(*)::int from ${sql}`, args);

  it("removes the application, its draft land, invoices and owner", async () => {
    const app = await submitted(45.2971);
    const [inv] = await feeInvoice(app);
    const owner = await scalar<string>(db, `select party_id from public.application_parties where application_id = $1`, [app]);
    await asUser(db, clerk, (tx) => tx.query(`select public.application_delete($1)`, [app]));
    expect(await count(`public.applications where id = $1`, [app])).toBe(0);
    expect(await count(`public.parcels where id = $1`, [inv!.parcel_id])).toBe(0);
    expect(await count(`public.invoices where id = $1`, [inv!.id])).toBe(0);
    expect(await count(`public.parties where id = $1`, [owner])).toBe(0);
  });

  it("a cancelled one is deleted too; an owner with other applications is kept", async () => {
    const first = await submitted(45.2972);
    const owner = await scalar<string>(db, `select party_id from public.application_parties where application_id = $1`, [first]);
    const second = await asUser(db, clerk, (tx) =>
      scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.2973, pin_lat: 2.04 })]),
    );
    await asUser(db, clerk, (tx) => tx.query(`select public.application_set_parties($1, $2)`, [second.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]));
    await asUser(db, clerk, (tx) => tx.query(`select public.application_transition($1, 'cancel', 'Duplicate')`, [first]));
    await asUser(db, clerk, (tx) => tx.query(`select public.application_delete($1)`, [first]));
    expect(await count(`public.applications where id = $1`, [first])).toBe(0);
    expect(await count(`public.parties where id = $1`, [owner])).toBe(1);
  });

  it("is refused once money was paid, or for staff without the right", async () => {
    const app = await submitted(45.2974);
    const [inv] = await feeInvoice(app);
    // Bills can be paid only on registered land.
    await db.query(`update public.parcels set status = 'registered', registered_at = now(), pun = coalesce(pun, 'FEE' || left(id::text, 8)), account_no = coalesce(account_no, left(id::text, 8)) where id = $1`, [inv!.parcel_id]);
    await asUser(db, cashier, (tx) =>
      tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: inv!.parcel_id, invoice_id: inv!.id, amount: 5, method: "cash" })]),
    );
    // Money taken before bills had to wait for registration still stops the delete.
    await db.query(`update public.parcels set status = 'draft', registered_at = null where id = $1`, [inv!.parcel_id]);
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.application_delete($1)`, [app]))).rejects.toThrow(/^CONFLICT: application_paid/);
    const other = await submitted(45.2975);
    await expect(asUser(db, cashier, (tx) => tx.query(`select public.application_delete($1)`, [other]))).rejects.toThrow(/^(PERMISSION_DENIED|NOT_FOUND)/);
  });
});
