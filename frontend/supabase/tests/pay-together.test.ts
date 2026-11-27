import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, scalar, square, testPrinter, completeLand } from "./harness";

let db: PGlite;
let admin: string;
let citizen: string;
let stranger: string;
let part: string;
let reg: string;
let regBill: string;
let partBill: string;
let otherBill: string;

const bill = async (parcel: string, district: string, n: string, total: number) => {
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'service_charge'`);
  return scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ($1, $2, $3, $4, '2026', current_date + 30, $5) returning id`,
    [n, parcel, district, fee, total],
  );
};
const start = (user: string, ids: string[]) =>
  asUser(db, user, (tx) => scalar<{ intent_id: string; amount: number; invoice_number: string }>(tx, `select public.payment_intent_create_many($1::uuid[], 'test', '+252610009977')`, [ids]), "aal1");

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  await db.query(`update public.payment_providers set enabled = true where code = 'test'`);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','Taleex','Taleh') returning id`, [sector]);
  const make = (house: string, status: string, i: number, pun: string | null) =>
    scalar<string>(
      db,
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, area_m2, geom, status, registered_at)
       values ($1, $1, $2, $3, $6, 100, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5::public.parcel_status, case when $5 = 'registered' then now() end) returning id`,
      [pun, hodan, nbhd, JSON.stringify(square(45.3 + i * 0.0003, 2.04, 0.0001)), status, house],
    );
  part = await make("11", "draft", 1, null);
  reg = await make("13", "registered", 2, "BNREG001");
  const other = await make("14", "registered", 3, "BNREG002");
  citizen = await createAuthUser(db, { phone: "+252610009966", fullName: "Two Lands" });
  stranger = await createAuthUser(db, { phone: "+252610009955", fullName: "Someone Else" });
  const owner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id, citizen_user_id) values ('Two Lands', '+252610009966', $1, $2) returning id`, [hodan, citizen]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $3, 'owner', 100), ($2, $3, 'owner', 100)`, [part, reg, owner]);
  regBill = await bill(reg, hodan, "INV-TAX-1", 30); // the yearly tax
  partBill = await bill(part, hodan, "INV-REG-1", 12); // registration
  otherBill = await bill(other, hodan, "INV-X-1", 5); // not theirs
});

describe("paying several bills together", () => {
  it("only the owner's own open bills", async () => {
    await expect(start(stranger, [regBill])).rejects.toThrow(/^NOT_FOUND/);
    await expect(start(citizen, [regBill, otherBill])).rejects.toThrow(/^NOT_FOUND/);
    await expect(start(citizen, [])).rejects.toThrow(/^VALIDATION/);
  });

  it("partial land can't be paid online by its owner (0279); registered land can", async () => {
    await expect(start(citizen, [regBill, partBill])).rejects.toThrow(/^CONFLICT: parcel_partial/);
    await expect(
      asUser(db, citizen, (tx) => tx.query(`select public.payment_intent_create($1, null, 'test', '+252610009977')`, [partBill]), "aal1"),
    ).rejects.toThrow(/^CONFLICT: parcel_partial/);
    const intent = await start(citizen, [regBill]);
    expect(Number(intent.amount)).toBe(30);
    const ref = await scalar<string>(db, `update public.payment_intents set provider_ref = 'tp-1' where id = $1 returning provider_ref`, [intent.intent_id]);
    const event = { status: "succeeded", provider_ref: ref, intent_id: intent.intent_id, amount: 30, currency: "USD" };
    const res = await asService(db, (tx) => scalar<{ result: string; payments: number }>(tx, `select public.webhook_ingest('test', 'tog1', true, $1, '{}')`, [JSON.stringify(event)]));
    expect(res.result).toBe("recorded");
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [regBill])).toBe("paid");
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).not.toBe("paid");
    const status = await asUser(db, citizen, (tx) => scalar<{ status: string; receipt_no: string }>(tx, `select public.payment_intent_status($1)`, [intent.intent_id]), "aal1");
    expect(status.status).toBe("succeeded");
  });

  it("staff who take payments can still collect for partial land online; it registers once paid", async () => {
    await completeLand(db);
    const intent = await asUser(db, admin, (tx) => scalar<{ intent_id: string; amount: number }>(tx, `select public.payment_intent_create_many($1::uuid[], 'test', '+252610009977')`, [[partBill]]));
    expect(Number(intent.amount)).toBe(12);
    await db.query(`update public.payment_intents set provider_ref = 'tp-2' where id = $1`, [intent.intent_id]);
    const event = { status: "succeeded", provider_ref: "tp-2", intent_id: intent.intent_id, amount: 12, currency: "USD" };
    const res = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'tog3', true, $1, '{}')`, [JSON.stringify(event)]));
    expect(res.result).toBe("recorded");
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("paid");
    expect(await scalar<string>(db, `select status from public.parcels where id = $1`, [part])).toBe("registered");
  });

  it("the same event again is not recorded twice", async () => {
    const intentId = await scalar<string>(db, `select id from public.payment_intents where provider_ref = 'tp-1'`);
    const event = { status: "succeeded", provider_ref: "tp-1", intent_id: intentId, amount: 30, currency: "USD" };
    const res = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'tog2', true, $1, '{}')`, [JSON.stringify(event)]));
    expect(res.result).toBe("already_recorded");
  });
});

describe("a receipt goes to the printer chosen", () => {
  it("staff choose a printer; the print program gets the receipt", async () => {
    const pay = await scalar<{ id: string; receipt_no: string }>(db, `select row_to_json(p) from (select id, receipt_no from public.payments order by created_at limit 1) p`);
    const { id: printer, key } = await testPrinter(db);
    const sent = await asUser(db, admin, (tx) => scalar<{ printer: string }>(tx, `select public.payment_send_to_printer($1, $2)`, [pay.id, printer]));
    expect(sent.printer).toBe("Office printer");
    await expect(asUser(db, admin, (tx) => tx.query(`select public.payment_send_to_printer($1, $2)`, [pay.id, printer]))).rejects.toThrow(/^CONFLICT: already_queued/);
    const claim = await as(db, "anon", {}, (tx) => scalar<{ job: { token: string; type: string; serial: string } }>(tx, `select public.agent_claim_job($1, '10.0.0.5')`, [key]));
    expect(claim.job.type).toBe("receipt");
    expect(claim.job.serial).toBe(pay.receipt_no);
    const page = await as(db, "anon", {}, (tx) => scalar<{ receipt: { receipt_no: string; allocations: unknown[] } }>(tx, `select public.agent_job_document($1)`, [claim.job.token]));
    expect(page.receipt.receipt_no).toBe(pay.receipt_no);
    expect(page.receipt.allocations).toHaveLength(1);
    const choices = await asUser(db, admin, (tx) => tx.query(`select * from public.printer_choices(null)`));
    expect(choices.rows).toHaveLength(1);
  });
});
