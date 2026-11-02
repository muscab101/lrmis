import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let desk: string;
let registrar: string;
let registrar2: string;
let legal: string;
let legal2: string;
let gis: string;
let planner: string;
let planner2: string;
let hodan: string;
let nbhd: string;
let parcel: string;
let land: string;
let sellerParty: string;
let buyerA: string;
let buyerB: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const LON = 45.3;
const LAT = 2.04;
const D = 0.0005;
const half = (west: boolean) => ({
  type: "Polygon",
  coordinates: [
    west
      ? [[LON - D, LAT - D], [LON, LAT - D], [LON, LAT + D], [LON - D, LAT + D], [LON - D, LAT - D]]
      : [[LON, LAT - D], [LON + D, LAT - D], [LON + D, LAT + D], [LON, LAT + D], [LON, LAT - D]],
  ],
});

async function registered(pun: string, account: string, geom: object, ownership = "private") {
  return scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, ownership, area_m2, geom, status, registered_at)
     values ($1, $2, $3, $4, 'residential', $5::public.ownership_type, round(extensions.st_area(extensions.st_setsrid(extensions.st_geomfromgeojson($6), 4326)::extensions.geography)::numeric, 2),
             extensions.st_setsrid(extensions.st_geomfromgeojson($6), 4326), 'registered', now()) returning id`,
    [pun, account, hodan, nbhd, ownership, JSON.stringify(geom)],
  );
}

const owners = (p: string) =>
  db.query<{ full_name: string; share_pct: string }>(`select pa.full_name, po.share_pct from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = $1 and po.valid_to is null order by pa.full_name`, [p]).then((r) => r.rows);

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
    [sector, JSON.stringify(square(LON, LAT, 0.01))],
  );
  admin = await bootstrapSuperAdmin(db);
  desk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  registrar2 = await createStaff(db, admin, "registrar2@gmail.com", ["registrar"], [hodan]);
  legal = await createStaff(db, admin, "legal@gmail.com", ["legal_officer"], [hodan]);
  legal2 = await createStaff(db, admin, "legal2@gmail.com", ["legal_officer"], [hodan]);
  gis = await createStaff(db, admin, "gis@gmail.com", ["gis_officer"], [hodan]);
  planner = await createStaff(db, admin, "planner@gmail.com", ["planning_officer"], [hodan]);
  planner2 = await createStaff(db, admin, "planner2@gmail.com", ["planning_officer"], [hodan]);

  parcel = await registered("BN-HDN-012-000001", "HDN0000001", square(LON, LAT, D));
  land = await registered("BN-HDN-012-000002", "HDN0000002", square(LON + 0.003, LAT, D), "public");
  await db.query(`insert into public.pun_counters (district_id, last_serial, last_account) values ($1, 2, 2)`, [hodan]);
  sellerParty = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Seller Xasan', '+252615550101') returning id`);
  buyerA = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Buyer Amina', '+252615550102') returning id`);
  buyerB = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Buyer Bashir', '+252615550103') returning id`);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, sellerParty]);
});

describe("transfers, disputes, liens, orders (Phase 9)", () => {
  let transfer: string;
  let lien: string;

  it("a lien blocks the sale until another legal officer releases it", async () => {
    transfer = await asUser(db, desk, (tx) => scalar<string>(tx, `select public.transfer_create($1, 'sale', 10000, null, 'Sold to the Amina family')`, [parcel]));
    await expectError(
      asUser(db, desk, (tx) => tx.query(`select public.transfer_set_recipients($1, $2)`, [transfer, JSON.stringify([{ party_id: buyerA, role: "owner", share_pct: 60 }])])),
      "VALIDATION: shares_total",
    );
    await asUser(db, desk, (tx) =>
      tx.query(`select public.transfer_set_recipients($1, $2)`, [transfer, JSON.stringify([{ party_id: buyerA, role: "owner", share_pct: 60 }, { party_id: buyerB, role: "co_owner", share_pct: 40 }])]),
    );
    lien = await asUser(db, legal, (tx) => scalar<string>(tx, `select public.lien_register($1, $2)`, [parcel, JSON.stringify({ kind: "mortgage", holder: "Salaam Bank", amount: 5000, reference: "MTG-77" })]));
    await expectError(asUser(db, desk, (tx) => tx.query(`select public.transfer_submit($1)`, [transfer])), "CONFLICT: blocked:lien");
    await expectError(asUser(db, legal, (tx) => tx.query(`select public.lien_release($1, 'Loan repaid in full')`, [lien])), "MAKER_CHECKER");
    await asUser(db, legal2, (tx) => tx.query(`select public.lien_release($1, 'Loan repaid in full')`, [lien]));
    const out = await asUser(db, desk, (tx) => scalar<{ duty: number; invoice_id: string }>(tx, `select public.transfer_submit($1)`, [transfer]));
    expect(Number(out.duty)).toBe(200);
  });

  it("approval needs the stamp duty paid; it replaces the owners and cancels the certificate", async () => {
    await db.query(`insert into public.issued_documents (type, serial, verify_code, parcel_id, district_id, snapshot) values ('certificate', 'CERT-T-1', 'ABCDEFGHJKMN', $1, $2, '{}')`, [parcel, hodan]);
    await expectError(asUser(db, desk, (tx) => tx.query(`select public.transfer_decide($1, true, 'ok')`, [transfer])), "PERMISSION_DENIED");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.transfer_decide($1, true, 'ok')`, [transfer])), "CONFLICT: duty_unpaid");
    const inv = await scalar<string>(db, `select duty_invoice_id from public.transfers where id = $1`, [transfer]);
    await db.query(`select private.invoice_apply_payment($1, 200)`, [inv]);
    await asUser(db, registrar, (tx) => tx.query(`select public.transfer_decide($1, true, 'Deed and duty checked')`, [transfer]));
    expect(await owners(parcel)).toEqual([
      { full_name: "Buyer Amina", share_pct: "60.00" },
      { full_name: "Buyer Bashir", share_pct: "40.00" },
    ]);
    expect(await scalar<string>(db, `select status::text from public.issued_documents where serial = 'CERT-T-1'`)).toBe("cancelled");
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1 and valid_to is not null`, [parcel])).toBe(1);
  });

  it("an open dispute marks the parcel disputed and blocks transfers; closing it (someone else) restores it", async () => {
    const d = await asUser(db, legal, (tx) =>
      scalar<string>(tx, `select public.dispute_open($1, $2)`, [parcel, JSON.stringify({ kind: "boundary", description: "Neighbour claims 2 m of the east side", claimant_name: "Neighbour" })]),
    );
    expect(await scalar<string>(db, `select status::text from public.parcels where id = $1`, [parcel])).toBe("disputed");
    const t2 = await asUser(db, desk, (tx) => scalar<string>(tx, `select public.transfer_create($1, 'gift', 500, null, null)`, [parcel]));
    await asUser(db, desk, (tx) => tx.query(`select public.transfer_set_recipients($1, $2)`, [t2, JSON.stringify([{ party_id: sellerParty, role: "owner", share_pct: 100 }])]));
    await expectError(asUser(db, desk, (tx) => tx.query(`select public.transfer_submit($1)`, [t2])), "CONFLICT: blocked:dispute");
    await expectError(asUser(db, legal, (tx) => tx.query(`select public.dispute_close($1, 'resolved', 'Survey re-checked')`, [d])), "MAKER_CHECKER");
    await asUser(db, legal2, (tx) => tx.query(`select public.dispute_close($1, 'resolved', 'Survey re-checked on site')`, [d]));
    expect(await scalar<string>(db, `select status::text from public.parcels where id = $1`, [parcel])).toBe("registered");
    await asUser(db, desk, (tx) => tx.query(`select public.transfer_cancel($1, 'Family changed their mind')`, [t2]));
  });

  it("a freeze order blocks permits until it is lifted", async () => {
    const o = await asUser(db, legal, (tx) =>
      scalar<string>(tx, `select public.court_order_add($1, $2)`, [parcel, JSON.stringify({ order_no: "BC/2026/14", court: "Banadir Regional Court", order_date: "2026-10-01", kind: "freeze", description: "No dealings pending case" })]),
    );
    await expectError(
      asUser(db, planner, (tx) => tx.query(`select public.permit_apply($1, $2)`, [parcel, JSON.stringify({ kind: "construction", description: "Two-storey house, 180 m²", applicant_name: "Amina" })])),
      "CONFLICT: blocked:freeze_order",
    );
    await asUser(db, legal2, (tx) => tx.query(`select public.court_order_lift($1, 'Case closed by the court')`, [o]));
  });

  it("permits: fee invoice, a second planner decides once it is paid", async () => {
    const out = await asUser(db, planner, (tx) =>
      scalar<{ permit_id: string; fee_invoice_id: string }>(tx, `select public.permit_apply($1, $2)`, [parcel, JSON.stringify({ kind: "construction", description: "Two-storey house, 180 m²", floors: 2, area_m2: 180, applicant_name: "Amina" })]),
    );
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [out.fee_invoice_id]))).toBe(50);
    await expectError(asUser(db, planner2, (tx) => tx.query(`select public.permit_decide($1, true, 'Max 2 floors', '')`, [out.permit_id])), "CONFLICT: fee_unpaid");
    await db.query(`select private.invoice_apply_payment($1, 50)`, [out.fee_invoice_id]);
    await expectError(asUser(db, planner, (tx) => tx.query(`select public.permit_decide($1, true, 'x', '')`, [out.permit_id])), "MAKER_CHECKER");
    await asUser(db, planner2, (tx) => tx.query(`select public.permit_decide($1, true, 'Max 2 floors; 3 m setback', '')`, [out.permit_id]));
    const p = await scalar<{ status: string; valid_until: string }>(db, `select row_to_json(p) from public.permits p where id = $1`, [out.permit_id]);
    expect(p.status).toBe("approved");
    expect(p.valid_until).not.toBeNull();
  });
});

describe("subdivision, merge, change of use, leases (Phase 9)", () => {
  let children: string[];

  it("rejects children that overlap or don't add up to the parent", async () => {
    await expectError(
      asUser(db, gis, (tx) => tx.query(`select public.parcel_change_request('subdivide', $1, $2, 'Split for two heirs')`, [[parcel], JSON.stringify({ children: [half(true), half(true)] })])),
      "VALIDATION: children_overlap",
    );
    await expectError(
      asUser(db, gis, (tx) => tx.query(`select public.parcel_change_request('subdivide', $1, $2, 'Split for two heirs')`, [[parcel], JSON.stringify({ children: [half(true), square(LON + D / 2, LAT, D / 4)] })])),
      "VALIDATION: children_area",
    );
  });

  it("subdivides into the parent's PUN with A and B, owned by the people chosen; the parent is archived", async () => {
    await expectError(
      asUser(db, gis, (tx) => tx.query(`select public.parcel_change_request('subdivide', $1, $2, 'Split for two heirs')`, [[parcel], JSON.stringify({ children: [half(true), half(false)], owners: [[buyerA]] })])),
      "VALIDATION: child_owners",
    );
    const parentPun = await scalar<string>(db, `select pun from public.parcels where id = $1`, [parcel]);
    await db.query(`update public.parcels set house_no = '07', property_type = 'villa' where id = $1`, [parcel]);
    const id = await asUser(db, gis, (tx) =>
      scalar<string>(tx, `select public.parcel_change_request('subdivide', $1, $2, 'Split for two heirs')`, [[parcel], JSON.stringify({ children: [half(true), half(false)], owners: [[buyerA, buyerB], [buyerA, buyerB]] })]),
    );
    await expectError(asUser(db, gis, (tx) => tx.query(`select public.permit_apply($1, '{}')`, [parcel])), "PERMISSION_DENIED");
    const out = await asUser(db, registrar, (tx) => scalar<{ new_parcels: string[] }>(tx, `select public.parcel_change_decide($1, true, 'Checked on the map')`, [id]));
    children = out.new_parcels;
    expect(children).toHaveLength(2);
    const rows = await db.query<{ pun: string; status: string }>(`select pun, status::text from public.parcels where id = any ($1) order by pun`, [children]);
    expect(rows.rows.map((r) => r.pun)).toEqual([`${parentPun}A`, `${parentPun}B`]);
    expect((await db.query<{ house_no: string }>(`select house_no from public.parcels where id = any ($1) order by pun`, [children])).rows.map((r) => r.house_no)).toEqual(["07A", "07B"]);
    // They keep the type, or billing runs could never price them (0142).
    expect((await db.query<{ property_type: string }>(`select property_type from public.parcels where id = any ($1)`, [children])).rows.map((r) => r.property_type)).toEqual(["villa", "villa"]);
    expect(rows.rows.every((r) => r.status === "registered")).toBe(true);
    expect(await scalar<string>(db, `select status::text from public.parcels where id = $1`, [parcel])).toBe("archived");
    expect(await owners(children[0]!)).toHaveLength(2);
    const first = await db.query<{ party_id: string; role: string; share_pct: string }>(
      `select party_id, role::text, share_pct from public.parcel_owners where parcel_id = $1 and valid_to is null order by role::text desc`,
      [children[0]],
    );
    expect(first.rows.map((r) => [r.party_id, r.role, Number(r.share_pct)])).toEqual([
      [buyerA, "owner", 50],
      [buyerB, "co_owner", 50],
    ]);
  });

  it("merges adjacent parcels with the same owners back into one", async () => {
    const id = await asUser(db, gis, (tx) => scalar<string>(tx, `select public.parcel_change_request('merge', $1, '{}', 'Owners want one plot again')`, [children]));
    const out = await asUser(db, registrar2, (tx) => scalar<{ new_parcels: string[] }>(tx, `select public.parcel_change_decide($1, true, 'ok')`, [id]));
    const merged = out.new_parcels[0]!;
    const area = Number(await scalar<string>(db, `select area_m2 from public.parcels where id = $1`, [merged]));
    const parentArea = Number(await scalar<string>(db, `select area_m2 from public.parcels where id = $1`, [parcel]));
    expect(Math.abs(area - parentArea)).toBeLessThan(1);
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where id = any ($1) and status = 'archived'`, [children])).toBe(2);
    children = [merged];
  });

  it("change of use takes effect on approval", async () => {
    const id = await asUser(db, gis, (tx) => scalar<string>(tx, `select public.parcel_change_request('change_of_use', $1, '{"land_use":"commercial"}', 'Shop opened on the ground floor')`, [children]));
    await asUser(db, registrar, (tx) => tx.query(`select public.parcel_change_decide($1, true, 'ok')`, [id]));
    expect(await scalar<string>(db, `select land_use::text from public.parcels where id = $1`, [children[0]])).toBe("commercial");
  });

  it("leases only on public land; one active lease per parcel", async () => {
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.lease_create($1, $2, '2026-11-01', '2031-10-31', 1200, 'Kiosk')`, [children[0], buyerA])), "VALIDATION: not_public_land");
    const lease = await asUser(db, registrar, (tx) => scalar<string>(tx, `select public.lease_create($1, $2, '2026-11-01', '2031-10-31', 1200, 'Market stalls')`, [land, buyerA]));
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.lease_create($1, $2, '2026-11-01', '2031-10-31', 1200, 'Again')`, [land, buyerB])), "CONFLICT: lease_active");
    await asUser(db, registrar, (tx) => tx.query(`select public.lease_end($1, true, 'Rent unpaid for a year')`, [lease]));
    expect(await scalar<string>(db, `select status::text from public.leases where id = $1`, [lease])).toBe("terminated");
  });
});

describe("transfer approval without a second person (0109)", () => {
  it("the person who started a transfer may approve it", async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'transfer_decide'`);
    expect(src).not.toContain("assert_maker_checker");
    expect(src).toContain("assert_permission('transfers.approve')");
  });
});

describe("parcel change approval without a second person (0128)", () => {
  it("the person who requested a parcel change may approve it", async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'parcel_change_decide'`);
    expect(src).not.toContain("assert_maker_checker");
    expect(src).toContain("assert_permission('parcels.approve')");
  });
});
