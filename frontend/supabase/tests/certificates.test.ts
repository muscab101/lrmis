import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, scalar, square, printOnPrinter, testPrinter } from "./harness";

let db: PGlite;
let admin: string;
let registrar: string;
let registrar2: string;
let printer: string;
let citizen: string;
let hodan: string;
let nbhd: string;
let parcel: string;
let taxInvoice: string;
let certId: string;
let certCode: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

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
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  registrar2 = await createStaff(db, admin, "registrar2@gmail.com", ["registrar"], [hodan]);
  printer = await createStaff(db, admin, "printer@gmail.com", ["print_officer"], [hodan]);
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Owner" });

  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, developed, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', true, 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  // A neighbour so the map extract has something next to it.
  await db.query(
    `insert into public.parcels (pun, account_no, registered_at, district_id, neighbourhood_id, area_m2, geom, status) values ('BN-HDN-012-000002', 'HDN0000002', now(), $1, $2, 300, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered')`,
    [hodan, nbhd, JSON.stringify(square(45.3002, 2.04, 0.0001))],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, citizen_user_id) values ('Cabdi Xasan Maxamed', '+252615550101', $1) returning id`, [citizen]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  taxInvoice = await scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values (private.invoice_number(2026), $1, $2, $3, '2026', current_date + 30, 100) returning id`,
    [parcel, hodan, tax],
  );
});

describe("certificates (Phase 8)", () => {
  it("an unpaid balance blocks the certificate", async () => {
    const e = await asUser(db, registrar, (tx) => scalar<{ blockers: string[] }>(tx, `select public.certificate_eligibility($1)`, [parcel]));
    expect(e.blockers).toEqual(["unpaid"]);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.certificate_issue($1)`, [parcel])), "CONFLICT: not_eligible:unpaid");
  });

  it("once paid: certificate + an ID card per owner, with a frozen snapshot; only one valid certificate", async () => {
    await db.query(`select private.invoice_apply_payment($1, 100)`, [taxInvoice]);
    await expectError(asUser(db, printer, (tx) => tx.query(`select public.certificate_issue($1)`, [parcel])), "PERMISSION_DENIED");
    const out = await asUser(db, registrar, (tx) => scalar<{ certificate_id: string; id_cards: number }>(tx, `select public.certificate_issue($1)`, [parcel]));
    expect(out.id_cards).toBe(1);
    certId = out.certificate_id;
    const doc = await scalar<{ serial: string; verify_code: string; snapshot: { pun: string; owners: unknown[]; adjacent: unknown[]; registrar: string } }>(
      db,
      `select row_to_json(d) from public.issued_documents d where id = $1`,
      [certId],
    );
    expect(doc.serial).toBe("CERT-2026-000001");
    expect(doc.verify_code).toMatch(/^[A-HJ-KM-NP-Z2-9]{12}$/);
    expect(doc.snapshot.pun).toBe("BN-HDN-012-000001");
    expect(doc.snapshot.owners).toHaveLength(1);
    expect(doc.snapshot.adjacent).toHaveLength(1);
    certCode = doc.verify_code;
    const card = await scalar<{ serial: string; expires_at: string }>(db, `select row_to_json(d) from public.issued_documents d where type = 'id_card'`);
    expect(card.serial).toBe("IDC-2026-000001");
    expect(card.expires_at).not.toBeNull();
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.certificate_issue($1)`, [parcel])), "CONFLICT: already_issued");
  });

  it("the first print is logged once; printing again needs a reprint", async () => {
    const { id: office } = await testPrinter(db);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [certId, office])), "PERMISSION_DENIED");
    await printOnPrinter(db, printer, certId);
    await expectError(asUser(db, printer, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [certId, office])), "CONFLICT: already_printed");
    expect(await scalar<number>(db, `select count(*)::int from public.print_jobs where document_id = $1 and kind = 'original'`, [certId])).toBe(1);
  });

  it("anyone can verify by code: status and initials only", async () => {
    const v = await as(db, "anon", {}, (tx) => scalar<{ status: string; serial: string; owners: string[]; pun: string }>(tx, `select public.verify_document($1)`, [certCode.toLowerCase()]));
    expect(v.status).toBe("valid");
    expect(v.serial).toBe("CERT-2026-000001");
    expect(v.owners).toEqual(["C. X. M."]);
    expect(JSON.stringify(v)).not.toContain("+252");
    const none = await as(db, "anon", {}, (tx) => scalar<unknown>(tx, `select public.verify_document('AAAAAAAAAAAA')`));
    expect(none).toBeNull();
  });

  it("reprint: fee invoice, a second approver, fee paid → new serial; the old one is cancelled", async () => {
    const req = await asUser(db, registrar, (tx) => scalar<{ request_id: string; fee_invoice_id: string }>(tx, `select public.reprint_request($1, 'Original damaged by water')`, [certId]));
    expect(Number(await scalar<string>(db, `select total from public.invoices where id = $1`, [req.fee_invoice_id]))).toBe(20);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.reprint_request($1, 'Second request at once')`, [certId])), "CONFLICT: reprint_pending");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.reprint_decide($1, true, 'ok')`, [req.request_id])), "MAKER_CHECKER");
    await expectError(asUser(db, registrar2, (tx) => tx.query(`select public.reprint_decide($1, true, 'ok')`, [req.request_id])), "CONFLICT: fee_unpaid");
    await db.query(`select private.invoice_apply_payment($1, 20)`, [req.fee_invoice_id]);
    const out = await asUser(db, registrar2, (tx) => scalar<{ document_id: string }>(tx, `select public.reprint_decide($1, true, 'Fee paid at the desk')`, [req.request_id]));
    const fresh = await scalar<{ serial: string; status: string; replaces_id: string; print_count: number }>(db, `select row_to_json(d) from public.issued_documents d where id = $1`, [out.document_id]);
    expect(fresh.serial).toBe("CERT-2026-000002");
    expect(fresh.status).toBe("valid");
    expect(fresh.replaces_id).toBe(certId);
    expect(await scalar<string>(db, `select status::text from public.issued_documents where id = $1`, [certId])).toBe("cancelled");
    const old = await as(db, "anon", {}, (tx) => scalar<{ status: string }>(tx, `select public.verify_document($1)`, [certCode]));
    expect(old.status).toBe("cancelled");
    await printOnPrinter(db, printer, out.document_id);
    expect(await scalar<string>(db, `select kind from public.print_jobs where document_id = $1`, [out.document_id])).toBe("reprint");
  });

  it("owners see their documents, strangers don't; a disputed parcel can't get a certificate", async () => {
    expect((await asUser(db, citizen, (tx) => tx.query(`select id from public.issued_documents`), "aal1")).rows.length).toBe(3);
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    expect((await asUser(db, stranger, (tx) => tx.query(`select id from public.issued_documents`), "aal1")).rows).toHaveLength(0);
    const other = await scalar<string>(db, `select id from public.parcels where pun = 'BN-HDN-012-000002'`);
    await db.query(`update public.parcels set status = 'disputed' where id = $1`, [other]);
    const e = await asUser(db, registrar, (tx) => scalar<{ blockers: string[] }>(tx, `select public.certificate_eligibility($1)`, [other]));
    expect(e.blockers).toEqual(expect.arrayContaining(["disputed", "no_owner"]));
  });
});
