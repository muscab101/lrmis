import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createAuthUser, createDb, scalar, square } from "./harness";

let db: PGlite;
let citizen: string;
let parcel: string;
let invoice: string;
const PHONE = "+252615550101";

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
  citizen = await createAuthUser(db, { phone: PHONE, fullName: "Owner" });
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  const party = await scalar<string>(db, `insert into public.parties (full_name, phone, citizen_user_id) values ('Cabdi Xasan', $1, $2) returning id`, [PHONE, citizen]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  invoice = await scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, due_date, total) values ('INV-2026-000001', $1, $2, $3, '2026', current_date + 30, 120) returning id`,
    [parcel, hodan, tax],
  );
  await db.query(
    `insert into public.applications (number, channel, district_id, applicant_party_id, citizen_user_id, status, submitted_at) values ('APP-2026-000001', 'portal', $1, $2, $3, 'in_survey', now())`,
    [hodan, party, citizen],
  );
});

describe("citizen portal and channels (Phase 11)", () => {
  it("citizen_overview returns my parcels, balances and pay tokens — and nothing for strangers", async () => {
    const o = await asUser(db, citizen, (tx) => scalar<{ parcels: { pun: string; balance: number; invoices: { number: string; token: string | null }[] }[] }>(tx, `select public.citizen_overview()`), "aal1");
    expect(o.parcels).toHaveLength(1);
    expect(o.parcels[0]!.pun).toBe("BN-HDN-012-000001");
    expect(Number(o.parcels[0]!.balance)).toBe(120);
    expect(o.parcels[0]!.invoices[0]!.number).toBe("INV-2026-000001");
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    const s = await asUser(db, stranger, (tx) => scalar<{ parcels: unknown[] }>(tx, `select public.citizen_overview()`), "aal1");
    expect(s.parcels).toHaveLength(0);
  });

  it("channel functions are service-only", async () => {
    await expectError(asUser(db, citizen, (tx) => tx.query(`select public.channel_balance($1)`, [PHONE]), "aal1"), "permission denied");
  });

  it("balance and tracking answer only for the owner's own phone", async () => {
    const mine = await asService(db, (tx) => scalar<{ pun: string; balance: number }[]>(tx, `select public.channel_balance($1)`, [PHONE]));
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.balance)).toBe(120);
    expect(await asService(db, (tx) => scalar<unknown[]>(tx, `select public.channel_balance('+252615550199')`))).toEqual([]);
    const tr = await asService(db, (tx) => scalar<{ status: string } | null>(tx, `select public.channel_track($1, 'app-2026-000001')`, [PHONE]));
    expect(tr?.status).toBe("in_survey");
    expect(await asService(db, (tx) => scalar<unknown>(tx, `select public.channel_track('+252615550199', 'APP-2026-000001')`))).toBeNull();
  });

  it("pay link: queued once per hour for my own invoice; unknown invoices return null", async () => {
    const r = await asService(db, (tx) => scalar<{ number: string } | null>(tx, `select public.channel_send_pay_link($1, 'inv-2026-000001', 'en')`, [PHONE]));
    expect(r?.number).toBe("INV-2026-000001");
    await asService(db, (tx) => tx.query(`select public.channel_send_pay_link($1, 'INV-2026-000001', 'en')`, [PHONE]));
    const msgs = await db.query<{ body: string }>(`select body from public.messages where template_code = 'pay_link'`);
    expect(msgs.rows).toHaveLength(1);
    const token = await scalar<string>(db, `select token from public.invoice_tokens where invoice_id = $1`, [invoice]);
    expect(msgs.rows[0]!.body).toContain(`/pay/${token}`);
    expect(msgs.rows[0]!.body).toContain("$120.00");
    expect(await asService(db, (tx) => scalar<unknown>(tx, `select public.channel_send_pay_link('+252615550199', 'INV-2026-000001', 'en')`))).toBeNull();
  });

  it("rate limit: the 31st request in an hour is refused", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) results.push(await asService(db, (tx) => scalar<boolean>(tx, `select public.channel_hit('ussd', '+252615550177', 'menu')`)));
    expect(results.slice(0, 30).every(Boolean)).toBe(true);
    expect(results[30]).toBe(false);
  });

  it("WhatsApp replies go to the outbox on the whatsapp channel; language follows the profile", async () => {
    await db.query(`update public.profiles set locale = 'en' where user_id = $1`, [citizen]);
    expect(await asService(db, (tx) => scalar<string>(tx, `select public.channel_preferred_lang($1)`, [PHONE]))).toBe("en");
    expect(await asService(db, (tx) => scalar<string>(tx, `select public.channel_preferred_lang('+252615550188')`))).toBe("so");
    const id = await asService(db, (tx) => scalar<string>(tx, `select public.channel_reply_whatsapp($1, 'Hello', 'en')`, [PHONE]));
    expect(await scalar<string>(db, `select channel::text from public.messages where id = $1`, [id])).toBe("whatsapp");
  });
});
