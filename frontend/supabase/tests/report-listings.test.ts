import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let exec: string;
let registrar: string;
let agent: string;
let hodan: string;
let karaan: string;
let area: { section: string; sector: string; nbhd: string; otherSection: string };

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  const otherSection = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S2','S2','S2') returning id`, [hodan]);
  area = { section, sector, nbhd, otherSection };
  const admin = await bootstrapSuperAdmin(db);
  exec = await createStaff(db, admin, "exec@gmail.com", ["executive"], "all");
  registrar = await createStaff(db, admin, "reg@gmail.com", ["registrar"], [karaan]);
  agent = await createStaff(db, admin, "agent@gmail.com", ["customer_service"], [hodan]);

  const registered = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at, house_no, property_type)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now(), '12', 'villa') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  await db.query(
    `insert into public.parcels (district_id, neighbourhood_id, land_use, area_m2, geom, status, geom_provisional)
     values ($1, $2, 'residential', 200, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'draft', true)`,
    [hodan, nbhd, JSON.stringify(square(45.301, 2.041, 0.0001))],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, id_type, id_number) values ('Cabdi Xasan Maxamed', '+252615550101', 'passport', 'P123') returning id`);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [registered, party]);
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  const invoice = await scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
     values (private.invoice_number(2026), $1, $2, $3, '2026', current_date - 5, current_date + 25, 100) returning id`,
    [registered, hodan, tax],
  );
  await db.query(
    `select private.record_payment(jsonb_build_object('parcel_id', $1::text, 'invoice_id', $2::text, 'method', 'cash', 'amount', 40, 'payer_phone', '+252615550101'))`,
    [registered, invoice],
  );
});

const range = `current_date - 30, current_date`;

describe("report listings", () => {
  it("billing summary: billed, collected and outstanding by month, district and fee", async () => {
    const r = await asUser(db, exec, (tx) => tx.query<{ district_en: string; billed: string; collected: string; outstanding: string }>(`select * from public.report_billing(${range})`));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ district_en: "Hodan" });
    expect([r.rows[0]!.billed, r.rows[0]!.collected, r.rows[0]!.outstanding].map(Number)).toEqual([100, 40, 60]);
  });

  it("invoices and payments list the PUN, the invoice and the amounts", async () => {
    const inv = await asUser(db, exec, (tx) => tx.query<{ pun: string; total: string; paid: string; balance: string }>(`select * from public.report_invoices(${range})`));
    expect(inv.rows[0]).toMatchObject({ pun: "BN-HDN-012-000001" });
    expect(Number(inv.rows[0]!.balance)).toBe(60);
    const pay = await asUser(db, exec, (tx) => tx.query<{ pun: string; invoices: string; amount: string }>(`select * from public.report_payments(${range})`));
    expect(pay.rows[0]!.invoices).toMatch(/^INV-/);
    expect(Number(pay.rows[0]!.amount)).toBe(40);
  });

  it("payments by type: each fee type split by way of paying; the listing filters by method and fee type", async () => {
    const r = await asUser(db, exec, (tx) =>
      tx.query<{ fee_type: string; payments: string; cash: string; evc_plus: string; card: string; other: string; total: string }>(
        `select * from public.report_payment_types(${range}, null, null, null, null, 'all')`,
      ),
    );
    const tax = r.rows.find((x) => x.fee_type === "property_tax")!;
    expect([tax.payments, tax.cash, tax.evc_plus, tax.card, tax.other, tax.total].map(Number)).toEqual([1, 40, 0, 0, 0, 40]);
    const pay = (args: string, params: unknown[] = []) =>
      asUser(db, exec, (tx) => tx.query<{ fee_types_en: string }>(`select * from public.report_payments(${range}, null, null, null, null, ${args})`, params));
    const cash = await pay("'cash', 'property_tax'");
    expect(cash.rows).toHaveLength(1);
    expect(cash.rows[0]!.fee_types_en).toMatch(/tax/i);
    expect((await pay("'card', null")).rows).toHaveLength(0);
    expect((await pay("null, 'id_card_print'")).rows).toHaveLength(0);
    await expect(pay("'bitcoin', null")).rejects.toThrow(/^VALIDATION: method/);
  });

  it("parcels: registered, partial and all, with owners and grade", async () => {
    const q = (kind: string) => asUser(db, exec, (tx) => tx.query<{ pun: string | null; owners: string | null; grade_en: string | null; provisional: boolean }>(`select * from public.report_parcels(null, $1)`, [kind]));
    expect((await q("all")).rows).toHaveLength(2);
    const reg = (await q("registered")).rows;
    expect(reg).toHaveLength(1);
    expect(reg[0]!.owners).toBe("Cabdi Xasan Maxamed");
    expect(reg[0]!.grade_en).not.toBeNull();
    const partial = (await q("partial")).rows;
    expect(partial).toHaveLength(1);
    expect(partial[0]!.pun).toBeNull();
    expect(partial[0]!.provisional).toBe(true);
    await expect(q("other")).rejects.toThrow(/^VALIDATION: kind/);
  });

  it("locations count parcels at every level and flag boundaries", async () => {
    const r = await asUser(db, exec, (tx) => tx.query<{ level: string; code: string; parcels: string; partial: string; has_boundary: boolean }>(`select * from public.report_locations()`));
    const by = (level: string, code: string) => r.rows.find((x) => x.level === level && x.code === code)!;
    expect(Number(by("district", "HDN").parcels)).toBe(2);
    expect(Number(by("section", "S1").parcels)).toBe(2);
    expect(Number(by("neighbourhood", "012").partial)).toBe(1);
    expect(by("neighbourhood", "012").has_boundary).toBe(true);
    expect(by("district", "KRN").has_boundary).toBe(false);
  });

  it("owners list their parcels; certificates list runs", async () => {
    const r = await asUser(db, exec, (tx) => tx.query<{ owner: string; pun: string; id_number: string }>(`select * from public.report_owners()`));
    expect(r.rows).toEqual([expect.objectContaining({ owner: "Cabdi Xasan Maxamed", pun: "BN-HDN-012-000001", id_number: "P123" })]);
    expect((await asUser(db, exec, (tx) => tx.query(`select * from public.report_certificates(${range})`))).rows).toEqual([]);
  });

  it("district scope and permission", async () => {
    // The Karaan registrar sees none of Hodan's rows.
    const inv = await asUser(db, registrar, (tx) => tx.query(`select * from public.report_invoices(${range})`));
    expect(inv.rows).toHaveLength(0);
    const parcels = await asUser(db, registrar, (tx) => tx.query(`select * from public.report_parcels()`));
    expect(parcels.rows).toHaveLength(0);
    const locs = await asUser(db, registrar, (tx) => tx.query<{ code: string }>(`select * from public.report_locations()`));
    expect(locs.rows.map((x) => x.code)).toEqual(["KRN"]);
    await expect(asUser(db, agent, (tx) => tx.query(`select * from public.report_owners()`))).rejects.toThrow(/^PERMISSION_DENIED/);
  });

  it("narrows by section, sector and neighbourhood, and returns the ids rows link to", async () => {
    const inv = (args: string, params: unknown[]) =>
      asUser(db, exec, (tx) => tx.query<{ invoice_id: string; parcel_id: string; pun: string }>(`select * from public.report_invoices(${range}, null, ${args})`, params));
    const inArea = await inv("$1, $2, $3", [area.section, area.sector, area.nbhd]);
    expect(inArea.rows).toHaveLength(1);
    expect(inArea.rows[0]!.invoice_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inArea.rows[0]!.parcel_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await inv("$1, null, null", [area.otherSection])).rows).toHaveLength(0);
    const parcels = await asUser(db, exec, (tx) => tx.query(`select * from public.report_parcels(null, 'all', $1)`, [area.otherSection]));
    expect(parcels.rows).toHaveLength(0);
    const billing = await asUser(db, exec, (tx) => tx.query(`select * from public.report_billing(${range}, null, null, null, $1)`, [area.nbhd]));
    expect(billing.rows).toHaveLength(1);
    const locs = await asUser(db, exec, (tx) => tx.query<{ level: string }>(`select * from public.report_locations(null, $1)`, [area.section]));
    expect(locs.rows.map((r) => r.level)).toEqual(["section", "sector", "neighbourhood"]);
    const owners = await asUser(db, exec, (tx) => tx.query<{ party_id: string }>(`select * from public.report_owners(null, null, $1)`, [area.sector]));
    expect(owners.rows).toHaveLength(1);
  });
});
