import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let registrar: string;
let printer: string;
let cashier: string;
let cards: string[];

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
  const admin = await bootstrapSuperAdmin(db);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  printer = await createStaff(db, admin, "printer@gmail.com", ["print_officer"], [hodan]);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  const parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at, house_no)
     values ('BNHDN01201', 'HDN0000001', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now(), '01') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  for (const name of ["Cali Xasan", "Xaawo Nuur"]) {
    const party = await scalar<string>(db, `insert into public.parties (full_name, phone) values ($1, '+252615550101') returning id`, [name]);
    await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 50)`, [parcel, party]);
  }
  await asUser(db, registrar, (tx) => tx.query(`select public.certificate_issue($1)`, [parcel]));
  cards = (await db.query<{ id: string }>(`select id from public.issued_documents where type = 'id_card' order by serial`)).rows.map((r) => r.id);
});

describe("ID card print fee", () => {
  it("while the fee is off, cards print as before and no bill can be raised", async () => {
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.card_print_bill($1)`, [cards[0]])), "CONFLICT: card_fee_not_set");
    await asUser(db, printer, (tx) => tx.query(`select public.document_print($1)`, [cards[0]]));
  });

  it("with the fee on: the cashier finds the card, raises a bill; it prints only once the bill is paid", async () => {
    await db.query(`update public.fee_types set active = true, amount = 5 where code = 'id_card_print'`);
    const found = await asUser(db, cashier, (tx) => tx.query<{ id: string; holder: string; fee_on: boolean; invoice_id: string | null }>(`select * from public.card_print_lookup('BN-HDN-012-01')`));
    expect(found.rows.map((r) => r.id).sort()).toEqual([...cards].sort());
    expect(found.rows.every((r) => r.fee_on && r.invoice_id === null)).toBe(true);

    await expectError(asUser(db, printer, (tx) => tx.query(`select public.document_print($1)`, [cards[1]])), "CONFLICT: card_fee_unpaid");
    await expectError(asUser(db, printer, (tx) => tx.query(`select public.card_print_bill($1)`, [cards[1]])), "PERMISSION_DENIED");
    const bill = await asUser(db, cashier, (tx) => scalar<{ invoice_id: string; number: string; existing: boolean }>(tx, `select public.card_print_bill($1)`, [cards[1]]));
    expect(bill.existing).toBe(false);
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [bill.invoice_id]))).toBe(5);
    // Asking again gives the same open bill.
    const again = await asUser(db, cashier, (tx) => scalar<{ invoice_id: string; existing: boolean }>(tx, `select public.card_print_bill($1)`, [cards[1]]));
    expect(again).toMatchObject({ invoice_id: bill.invoice_id, existing: true });
    // The bill is in the cashier's To collect list.
    const collect = await asUser(db, cashier, (tx) => tx.query<{ invoice_id: string }>(`select invoice_id from public.cashier_to_collect()`));
    expect(collect.rows.map((r) => r.invoice_id)).toContain(bill.invoice_id);

    await db.query(`select private.invoice_apply_payment($1, 5)`, [bill.invoice_id]);
    await asUser(db, printer, (tx) => tx.query(`select public.document_print($1)`, [cards[1]]));
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.card_print_bill($1)`, [cards[1]])), "CONFLICT: already_printed");
  });
});
