import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, scalar, square } from "./harness";

let db: PGlite;
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
  await bootstrapSuperAdmin(db);
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

  it("one payment for the total; each bill gets its own receipt and partial land registers", async () => {
    const intent = await start(citizen, [regBill, partBill]);
    expect(Number(intent.amount)).toBe(42);
    expect(intent.invoice_number).toContain("TAX-1");
    expect(intent.invoice_number).toContain("REG-1");
    const ref = await scalar<string>(db, `update public.payment_intents set provider_ref = 'tp-1' where id = $1 returning provider_ref`, [intent.intent_id]);
    const event = { status: "succeeded", provider_ref: ref, intent_id: intent.intent_id, amount: 42, currency: "USD" };
    const res = await asService(db, (tx) => scalar<{ result: string; payments: number }>(tx, `select public.webhook_ingest('test', 'tog1', true, $1, '{}')`, [JSON.stringify(event)]));
    expect(res.result).toBe("recorded");
    expect(res.payments).toBe(2);
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [regBill])).toBe("paid");
    expect(await scalar<string>(db, `select status from public.invoices where id = $1`, [partBill])).toBe("paid");
    expect(await scalar<number>(db, `select count(*)::int from public.payments where intent_id = $1 and status = 'completed'`, [intent.intent_id])).toBe(2);
    expect(await scalar<string>(db, `select status from public.parcels where id = $1`, [part])).toBe("registered");
    const status = await asUser(db, citizen, (tx) => scalar<{ status: string; receipt_no: string }>(tx, `select public.payment_intent_status($1)`, [intent.intent_id]), "aal1");
    expect(status.status).toBe("succeeded");
    expect(status.receipt_no.split(", ")).toHaveLength(2);
  });

  it("the same event again is not recorded twice", async () => {
    const intentId = await scalar<string>(db, `select id from public.payment_intents where provider_ref = 'tp-1'`);
    const event = { status: "succeeded", provider_ref: "tp-1", intent_id: intentId, amount: 42, currency: "USD" };
    const res = await asService(db, (tx) => scalar<{ result: string }>(tx, `select public.webhook_ingest('test', 'tog2', true, $1, '{}')`, [JSON.stringify(event)]));
    expect(res.result).toBe("already_recorded");
  });
});
