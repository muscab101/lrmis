import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let registrar: string;
let registrar2: string;
let printer: string;
let hodan: string;
let nbhd: string;
const parcels: string[] = [];
let partyA: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const validCert = (parcel: string) =>
  scalar<string>(db, `select id from public.issued_documents where parcel_id = $1 and type = 'certificate' and status = 'valid'`, [parcel]);

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
  partyA = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Cabdi Xasan', '+252615550101') returning id`);
  for (let i = 1; i <= 3; i++) {
    const id = await scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
       values ($1, $2, $3, $4, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($5), 4326), 'registered', now()) returning id`,
      [`BN-HDN-012-00000${i}`, `HDN000000${i}`, hodan, nbhd, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001))],
    );
    parcels.push(id);
    // The third parcel has no owner, so it can't get a certificate.
    if (i < 3) await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [id, partyA]);
  }
});

describe("certificate actions", () => {
  it("bulk issue: issues what it can and reports the rest", async () => {
    await expectError(asUser(db, printer, (tx) => tx.query(`select public.certificate_issue_bulk($1)`, [parcels])), "PERMISSION_DENIED");
    const out = await asUser(db, registrar, (tx) => scalar<{ issued: number; id_cards: number; failed: { pun: string; error: string }[] }>(tx, `select public.certificate_issue_bulk($1)`, [parcels]));
    expect(out.issued).toBe(2);
    expect(out.id_cards).toBe(2);
    expect(out.failed).toEqual([expect.objectContaining({ pun: "BN-HDN-012-000003", error: expect.stringContaining("no_owner") })]);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.certificate_issue_bulk('{}')`)), "VALIDATION: selection");
  });

  it("bulk print logs each first print once and reports the already printed", async () => {
    const ids = [await validCert(parcels[0]!), await validCert(parcels[1]!)];
    await asUser(db, printer, (tx) => tx.query(`select public.document_print($1)`, [ids[0]]));
    const out = await asUser(db, printer, (tx) => scalar<{ printed: string[]; failed: { error: string }[] }>(tx, `select public.document_print_bulk($1)`, [ids]));
    expect(out.printed).toEqual([ids[1]]);
    expect(out.failed[0]!.error).toContain("already_printed");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.document_print_bulk($1)`, [ids])), "PERMISSION_DENIED");
  });

  it("correct and reissue: shows what changed, no fee, another officer approves, ID cards follow the owners", async () => {
    const cert = await validCert(parcels[0]!);
    const partyB = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Faadumo Cali', '+252615550102') returning id`);
    await db.query(`update public.parcel_owners set valid_to = current_date where parcel_id = $1`, [parcels[0]]);
    await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcels[0], partyB]);
    await db.query(`update public.parcels set area_m2 = 420 where id = $1`, [parcels[0]]);

    const changes = await asUser(db, registrar, (tx) => scalar<{ field: string; before: string; after: string }[]>(tx, `select public.document_changes($1)`, [cert]));
    expect(changes.map((c) => c.field).sort()).toEqual(["area_m2", "owners"]);
    expect(changes.find((c) => c.field === "owners")!.after).toBe("Faadumo Cali (100%)");

    const req = await asUser(db, registrar, (tx) => scalar<{ request_id: string }>(tx, `select public.reissue_request($1, 'Owner changed after transfer')`, [cert]));
    expect(await scalar<string>(db, `select kind from public.reprint_requests where id = $1`, [req.request_id])).toBe("correction");
    expect(await scalar<string | null>(db, `select fee_invoice_id from public.reprint_requests where id = $1`, [req.request_id])).toBeNull();
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.reprint_decide($1, true, '')`, [req.request_id])), "MAKER_CHECKER");
    const out = await asUser(db, registrar2, (tx) => scalar<{ document_id: string }>(tx, `select public.reprint_decide($1, true, '')`, [req.request_id]));
    const cancelled = await scalar<string>(db, `select cancel_reason from public.issued_documents where id = $1`, [cert]);
    expect(cancelled).toBe("Corrected: Owner changed after transfer");
    const owners = await scalar<{ owners: { full_name: string }[]; area_m2: number }>(db, `select snapshot from public.issued_documents where id = $1`, [out.document_id]);
    expect(owners.owners.map((o) => o.full_name)).toEqual(["Faadumo Cali"]);
    // The former owner's card is cancelled, the new owner gets one.
    const cards = await db.query<{ party_id: string; status: string }>(`select party_id, status::text from public.issued_documents where parcel_id = $1 and type = 'id_card'`, [parcels[0]]);
    expect(cards.rows.find((c) => c.party_id === partyA)!.status).toBe("cancelled");
    expect(cards.rows.find((c) => c.party_id === partyB)!.status).toBe("valid");
  });

  it("one-step reprint: super admins only; completes a pending request and waives its fee", async () => {
    const cert = await validCert(parcels[1]!);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.reprint_direct($1, 'Lost by owner')`, [cert])), "PERMISSION_DENIED");
    await db.query(`update public.fee_types set active = true, amount = 20 where code = 'certificate_fee'`);
    const req = await asUser(db, admin, (tx) => scalar<{ request_id: string; fee_invoice_id: string }>(tx, `select public.reprint_request($1, 'Damaged in rain')`, [cert]));
    expect(req.fee_invoice_id).not.toBeNull();
    // The same super admin who asked can finish it in one step; the stored reason is reused.
    const out = await asUser(db, admin, (tx) => scalar<{ document_id: string }>(tx, `select public.reprint_direct($1, '')`, [cert]));
    const r = await scalar<{ status: string; new_document_id: string; decision_note: string }>(db, `select row_to_json(r) from public.reprint_requests r where id = $1`, [req.request_id]);
    expect(r.status).toBe("approved");
    expect(r.new_document_id).toBe(out.document_id);
    expect(r.decision_note).toContain("Damaged in rain");
    expect(await scalar<string>(db, `select status::text from public.invoices where id = $1`, [req.fee_invoice_id])).toBe("cancelled");
    // Without a pending request it records an approved one.
    const again = await asUser(db, admin, (tx) => scalar<{ document_id: string }>(tx, `select public.reprint_direct($1, 'Second copy for bank')`, [out.document_id]));
    expect(await scalar<number>(db, `select count(*)::int from public.reprint_requests where document_id = $1 and status = 'approved'`, [out.document_id])).toBe(1);
    expect(await scalar<string>(db, `select status::text from public.issued_documents where id = $1`, [again.document_id])).toBe("valid");
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.reprint_direct($1, 'x')`, [again.document_id])), "VALIDATION: reason");
  });

  it("a reprint still needs its fee paid when approved the normal way", async () => {
    const cert = await validCert(parcels[1]!);
    const req = await asUser(db, registrar, (tx) => scalar<{ request_id: string }>(tx, `select public.reprint_request($1, 'Owner lost it')`, [cert]));
    await expectError(asUser(db, registrar2, (tx) => tx.query(`select public.reprint_decide($1, true, '')`, [req.request_id])), "CONFLICT: fee_unpaid");
  });
});
