import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// Each role, with only that role, can do its own job — and doesn't get other jobs' pages.
let db: PGlite;
let admin: string;
let hodan: string;
let nbhd: string;
let parcel: string;
const u: Record<string, string> = {};

const can = (who: string, perm: string) => asUser(db, u[who]!, (tx) => scalar<boolean>(tx, `select public.has_permission($1)`, [perm]));

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
  admin = await bootstrapSuperAdmin(db);
  for (const r of ["registrar", "surveyor", "cashier", "billing_officer", "valuation_officer", "finance_manager", "auditor", "legal_officer", "print_officer", "citizen", "customer_service"]) {
    if (r === "citizen") continue;
    u[r] = await createStaff(db, admin, `${r}@gmail.com`, [r], r === "finance_manager" || r === "auditor" ? "all" : [hodan]);
  }
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at, house_no)
     values ('BNHDN01299', 'HDN0009999', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now(), '01') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Cali Xasan', '+252615550101', $1) returning id`, [hodan]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
});

describe("every role works on its own", () => {
  it("registrar: assigns a survey zone, issues the certificate, opens Yet to register and Owners", async () => {
    await asUser(db, u.registrar!, (tx) => tx.query(`select public.survey_zone_assign($1, $2, 20)`, [nbhd, u.surveyor]));
    await asUser(db, u.registrar!, (tx) => tx.query(`select public.certificate_issue($1)`, [parcel]));
    for (const p of ["parcels.yet_to_register", "owners.create", "certificates.id_cards", "reports.view"]) expect(await can("registrar", p)).toBe(true);
  });

  it("surveyor: adds an owner's land in their zone and sees it; no Parcels list", async () => {
    const out = await asUser(db, u.surveyor!, (tx) =>
      scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [
        JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3005, pin_lat: 2.0405, plot_width_m: 10, plot_length_m: 10, house_no: "9", owner_name: "Xaawo Nuur", owner_phone: "+252615550111" }),
      ]),
    );
    expect(await asUser(db, u.surveyor!, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where id = $1`, [out.parcel_id]))).toBe(1);
    expect(await can("surveyor", "owners.create")).toBe(true);
    expect(await can("surveyor", "parcels.view")).toBe(false);
  });

  it("valuation officer: sets a rate; billing officer: prepares a billing run", async () => {
    await asUser(db, u.valuation_officer!, (tx) => tx.query(`select public.valuation_set_rate($1, 'residential', false, 0.5, 10, '2026-01-01')`, [nbhd]));
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    await asUser(db, u.billing_officer!, (tx) => tx.query(`select public.billing_run_create($1)`, [JSON.stringify({ year: 2026, fee_type_id: tax, district_ids: [hodan], due_date: "2026-12-31" })]));
  });

  it("cashier: opens a shift and takes a payment; finance manager approves the closed shift; auditor verifies the payment", async () => {
    const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    await db.query(
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
       values (private.invoice_number(2026), $1, $2, $3, '2026', current_date, current_date + 30, 50)`,
      [parcel, hodan, tax],
    );
    const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
    const shift = await asUser(db, u.cashier!, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
    const pay = await asUser(db, u.cashier!, (tx) => scalar<{ payment_id: string }>(tx, `select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: parcel, amount: 50, currency: "USD", method: "cash" })]));
    await asUser(db, u.cashier!, (tx) => tx.query(`select public.shift_close($1, 50)`, [shift]));
    await asUser(db, u.finance_manager!, (tx) => tx.query(`select public.shift_approve($1)`, [shift]));
    await asUser(db, u.auditor!, (tx) => tx.query(`select public.payment_verify($1)`, [[pay.payment_id]]));
  });

  it("print officer prints the certificate; legal officer opens a dispute", async () => {
    const doc = await scalar<string>(db, `select id from public.issued_documents where type = 'certificate' and parcel_id = $1`, [parcel]);
    await asUser(db, u.print_officer!, (tx) => tx.query(`select public.document_print($1)`, [doc]));
    await asUser(db, u.legal_officer!, (tx) =>
      tx.query(`select public.dispute_open($1, $2)`, [parcel, JSON.stringify({ kind: "boundary", description: "Neighbour claims part of the plot", claimant_name: "Neighbour" })]),
    );
  });

  it("roles don't carry other jobs' pages", async () => {
    expect(await can("auditor", "users.view")).toBe(false);
    expect(await can("auditor", "parcels.view")).toBe(false);
    expect(await can("customer_service", "parcels.yet_to_register")).toBe(false);
    expect(await can("cashier", "parcels.view")).toBe(false);
    expect(await can("print_officer", "payments.view")).toBe(false);
    expect(
      await scalar<boolean>(db, `select 'parcels.yet_to_register' = any (default_permissions) from public.roles where key = 'citizen'`),
    ).toBe(false);
  });
});

describe("register land straight from the parcel (no Applications page)", () => {
  it("the registrar registers field land: PUN, tax bill and service charge, owners registered; only once", async () => {
    await db.query(`update public.property_grades set amount = 2 where code = (select code from public.property_grades order by sort limit 1)`);
    const grade = await scalar<string>(db, `select code from public.property_grades order by sort limit 1`);
    await db.query(`update public.fee_types set active = true, amount = 12 where code = 'service_charge'`);
    const land = await asUser(db, u.surveyor!, (tx) =>
      scalar<{ parcel_id: string; party_id: string }>(tx, `select public.field_land_create($1)`, [
        JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.301, pin_lat: 2.041, plot_width_m: 10, plot_length_m: 5, house_no: "15", property_type: grade, owner_name: "Maryan Cabdi", owner_phone: "+252615550222" }),
      ]),
    );
    await expect(asUser(db, u.surveyor!, (tx) => tx.query(`select public.parcel_register($1)`, [land.parcel_id]))).rejects.toThrow(/^PERMISSION_DENIED/);
    const r = await asUser(db, u.registrar!, (tx) => scalar<{ pun: string }>(tx, `select public.parcel_register($1)`, [land.parcel_id]));
    expect(r.pun).toMatch(/^BN/);
    const p = await scalar<{ status: string; pun: string }>(db, `select row_to_json(p) from public.parcels p where id = $1`, [land.parcel_id]);
    expect(p).toMatchObject({ status: "registered", pun: r.pun });
    const bills = await db.query<{ code: string; total: string }>(
      `select f.code, i.total from public.invoices i join public.fee_types f on f.id = i.fee_type_id where i.parcel_id = $1 order by f.code`,
      [land.parcel_id],
    );
    expect(bills.rows.map((b) => [b.code, Number(b.total)])).toEqual([["property_bill", 100], ["service_charge", 12]]);
    expect(await scalar<string | null>(db, `select registered_at from public.parties where id = $1`, [land.party_id])).not.toBeNull();
    await expect(asUser(db, u.registrar!, (tx) => tx.query(`select public.parcel_register($1)`, [land.parcel_id]))).rejects.toThrow(/^CONFLICT: status/);
  });
});
