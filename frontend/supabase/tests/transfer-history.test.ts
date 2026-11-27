import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

// Transfers: review steps, file categories and types, timeline, history with counts, ownership history (0296).
let db: PGlite;
let admin: string;
let desk: string;
let registrar: string;
let hodan: string;
let nbhd: string;
let parcel: string;
let seller: string;
let buyer: string;
let transfer: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const attach = (name: string, category = "sale_agreement", description: string | null = null) =>
  asUser(db, desk, (tx) =>
    scalar<string>(tx, `select public.transfer_document_add($1::uuid, $1::text || '/' || gen_random_uuid(), $2, 'application/octet-stream', 1200, $3, $4)`, [
      transfer,
      name,
      category,
      description,
    ]),
  );
const timeline = () => db.query<{ kind: string }>(`select kind from public.transfer_events where transfer_id = $1 order by id`, [transfer]).then((r) => r.rows.map((x) => x.kind));
const history = (as: string, p: object = {}) => asUser(db, as, (tx) => scalar<{ total: number; rows: { state: string; files: number; from_names: string; to_names: string }[]; stats: Record<string, number> }>(tx, `select public.transfer_history($1)`, [JSON.stringify(p)]));

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
    [sector, JSON.stringify(square(45.3, 2.04, 0.01))],
  );
  admin = await bootstrapSuperAdmin(db);
  desk = await createStaff(db, admin, "desk@gmail.com", ["front_desk_clerk"], [hodan]);
  await letClerksCreate(db);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, ownership, area_m2, geom, status, registered_at, house_no)
     values ('HDN01200001', 'HDN0000001', $1, $2, 'residential', 'private', 100, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now(), '07') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0005))],
  );
  seller = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Ahmed Ali', '+252615550101') returning id`);
  buyer = await scalar<string>(db, `insert into public.parties (full_name, phone) values ('Abdi Mohamed', '+252615550102') returning id`);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct, valid_from) values ($1, $2, 'owner', 100, '2018-01-01')`, [parcel, seller]);
});

describe("transfer review and history (0296)", () => {
  it("the new reasons exist", async () => {
    const names = (await db.query<{ name_en: string }>(`select name_en from public.transfer_types order by sort`)).rows.map((r) => r.name_en);
    expect(names).toEqual(expect.arrayContaining(["Family ownership transfer", "Court order", "Administrative correction", "Other"]));
  });

  it("files: only allowed types, each with a category and note", async () => {
    const type = await scalar<string>(db, `select id from public.transfer_types where name_en = 'Sale'`);
    transfer = await asUser(db, desk, (tx) => scalar<string>(tx, `select public.transfer_create_typed($1, $2, null, 'Sold')`, [parcel, type]));
    await asUser(db, desk, (tx) => tx.query(`select public.transfer_set_recipients($1, $2)`, [transfer, JSON.stringify([{ party_id: buyer, role: "owner", share_pct: 100 }])]));
    await expectError(attach("setup.exe"), "VALIDATION: document_type");
    await expectError(attach("notes.txt"), "VALIDATION: document_type");
    const pdf = await attach("Sale agreement.PDF", "sale_agreement", "Signed by both");
    await attach("voice.m4a", "witness");
    await attach("walk.mov", "nonsense-category");
    await attach("voice-note.ogg", "witness");
    const docs = (await db.query<{ category: string; description: string | null }>(`select category, description from public.transfer_documents where transfer_id = $1 order by uploaded_at, file_name`, [transfer])).rows;
    expect(docs.map((d) => d.category).sort()).toEqual(["other", "sale_agreement", "witness", "witness"]);
    expect(pdf).toBeTruthy();
  });

  it("review: start, ask for documents (approval refused), a new file puts it back under review", async () => {
    await asUser(db, desk, (tx) => tx.query(`select public.transfer_submit($1)`, [transfer]));
    const inv = await scalar<string>(db, `select duty_invoice_id from public.transfers where id = $1`, [transfer]);
    if (inv) await db.query(`select private.invoice_apply_payment($1, (select total from public.invoices where id = $1))`, [inv]);
    await expectError(asUser(db, desk, (tx) => tx.query(`select public.transfer_review($1, 'start')`, [transfer])), "PERMISSION_DENIED");
    await asUser(db, registrar, (tx) => tx.query(`select public.transfer_review($1, 'start')`, [transfer]));
    expect((await history(registrar)).rows[0]!.state).toBe("under_review");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.transfer_review($1, 'request_documents', 'x')`, [transfer])), "VALIDATION: note_required");
    await asUser(db, registrar, (tx) => tx.query(`select public.transfer_review($1, 'request_documents', 'Copy of the buyer ID card')`, [transfer]));
    expect((await history(registrar)).rows[0]!.state).toBe("needs_documents");
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.transfer_decide($1, true, 'ok')`, [transfer])), "CONFLICT: needs_documents");
    await attach("buyer-id.jpg", "identification");
    expect((await history(registrar)).rows[0]!.state).toBe("under_review");
  });

  it("approved: old owner closed and linked to the transfer, new owner opened from it; the timeline tells it all", async () => {
    await asUser(db, registrar, (tx) => tx.query(`select public.transfer_decide($1, true, 'Checked')`, [transfer]));
    const own = await asUser(db, registrar, (tx) =>
      tx.query<{ full_name: string; current: boolean; ended_transfer_id: string | null; source_transfer_id: string | null }>(
        `select full_name, current, ended_transfer_id, source_transfer_id from public.parcel_ownership_history($1)`,
        [parcel],
      ),
    );
    expect(own.rows).toEqual([
      { full_name: "Abdi Mohamed", current: true, ended_transfer_id: null, source_transfer_id: transfer },
      { full_name: "Ahmed Ali", current: false, ended_transfer_id: transfer, source_transfer_id: null },
    ]);
    expect(await timeline()).toEqual([
      "initiated", "previous_owner", "new_owner", "document", "document", "document", "document", "submitted",
      "under_review", "needs_documents", "document", "under_review", "approved", "ownership_updated",
    ]);
  });

  it("history: filters and counts", async () => {
    const all = await history(registrar);
    expect(all.stats).toMatchObject({ total: 1, approved: 1, pending: 0, rejected: 0, this_month: 1 });
    expect(all.rows[0]).toMatchObject({ files: 5, from_names: "Ahmed Ali", to_names: "Abdi Mohamed", state: "approved" });
    expect((await history(registrar, { q: "ahmed" })).total).toBe(1);
    expect((await history(registrar, { q: "HDN012" })).total).toBe(1);
    expect((await history(registrar, { state: "rejected" })).total).toBe(0);
    expect((await history(registrar, { neighbourhood: nbhd })).total).toBe(1);
  });
});
