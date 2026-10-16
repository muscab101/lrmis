import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asService, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let manager: string;
let agent: string;
let exec: string;
let citizen: string;
let hodan: string;
let parcel: string;
let party: string;
let invoice: string;
let app: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  manager = await createStaff(db, admin, "manager@gmail.com", ["admin"], "all");
  agent = await createStaff(db, admin, "agent@gmail.com", ["customer_service"], [hodan]);
  exec = await createStaff(db, admin, "exec@gmail.com", ["executive"], "all");
  citizen = await createAuthUser(db, { phone: "+252615550101", fullName: "Owner" });

  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
     values ('BN-HDN-012-000001', 'HDN0000001', $1, $2, 'residential', 400, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  party = await scalar<string>(db, `insert into public.parties (full_name, phone, citizen_user_id) values ('Cabdi Xasan Maxamed', '+252615550101', $1) returning id`, [citizen]);
  await db.query(`insert into public.parcel_owners (parcel_id, party_id, role, share_pct) values ($1, $2, 'owner', 100)`, [parcel, party]);
  const tax = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  invoice = await scalar<string>(
    db,
    `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
     values (private.invoice_number(2026), $1, $2, $3, '2026', current_date - 60, current_date - 40, 100) returning id`,
    [parcel, hodan, tax],
  );
  app = await scalar<string>(
    db,
    `insert into public.applications (number, channel, district_id, applicant_party_id, citizen_user_id, status, submitted_at)
     values ('APP-2026-000001', 'portal', $1, $2, $3, 'in_survey', now()) returning id`,
    [hodan, party, citizen],
  );
});

describe("messages and reports (Phase 10)", () => {
  it("an application step queues an SMS and an in-app notice for the applicant", async () => {
    await db.query(`update public.applications set status = 'public_notice' where id = $1`, [app]);
    const m = await scalar<{ to_address: string; body: string; template_code: string }>(db, `select row_to_json(m) from public.messages m where related_id = $1`, [app]);
    expect(m.template_code).toBe("application_status");
    expect(m.to_address).toBe("+252615550101");
    expect(m.body).toContain("APP-2026-000001");
    expect(m.body).toContain("ogeysiis dadweyne");
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'application.public_notice'`, [citizen])).toBe(1);
    // The same step again doesn't send twice.
    await db.query(`update public.applications set status = 'in_survey' where id = $1`, [app]);
    await db.query(`update public.applications set status = 'public_notice' where id = $1`, [app]);
    expect(await scalar<number>(db, `select count(*)::int from public.messages where related_id = $1 and body like '%dadweyne%'`, [app])).toBe(1);
  });

  it("a payment queues a receipt SMS", async () => {
    const pay = await scalar<{ payment_id: string; receipt_no: string }>(
      db,
      `select private.record_payment(jsonb_build_object('parcel_id', $1::text, 'invoice_id', $2::text, 'method', 'cash', 'amount', 40, 'payer_phone', '+252615550101'))`,
      [parcel, invoice],
    );
    const body = await scalar<string>(db, `select body from public.messages where related_id = $1`, [pay.payment_id]);
    expect(body).toContain("$40.00");
    expect(body).toContain(pay.receipt_no);
    expect(body).toContain("BN-HDN-012-000001");
  });

  it("campaigns: preview, create, a second person approves, then messages are queued once", async () => {
    const preview = await asUser(db, agent, (tx) =>
      scalar<{ recipients: number; sample_so: string }>(tx, `select public.campaign_preview('overdue_reminder', '{"kind":"overdue","min_days":30}', $1)`, [hodan]),
    );
    expect(preview.recipients).toBe(1);
    expect(preview.sample_so).toContain("$60.00");
    await expectError(asUser(db, agent, (tx) => tx.query(`select public.campaign_create('payment_receipt', '{"kind":"overdue"}', $1, '')`, [hodan])), "VALIDATION: template");
    await expectError(asUser(db, agent, (tx) => tx.query(`select public.campaign_create('overdue_reminder', '{"kind":"overdue","min_days":90}', $1, '')`, [hodan])), "VALIDATION: no_recipients");
    await expectError(asUser(db, agent, (tx) => tx.query(`select public.campaign_create('overdue_reminder', '{"kind":"overdue"}', null, '')`)), "VALIDATION: district");
    const c = await asUser(db, agent, (tx) =>
      scalar<{ id: string; recipients: number }>(tx, `select public.campaign_create('overdue_reminder', '{"kind":"overdue","min_days":30}', $1, 'Monthly reminder')`, [hodan]),
    );
    expect(c.recipients).toBe(1);
    await expectError(asUser(db, agent, (tx) => tx.query(`select public.campaign_decide($1, true, '')`, [c.id])), "PERMISSION_DENIED");
    const n = await asUser(db, manager, (tx) => scalar<number>(tx, `select public.campaign_decide($1, true, 'ok')`, [c.id]));
    expect(n).toBe(1);
    await expectError(asUser(db, manager, (tx) => tx.query(`select public.campaign_decide($1, true, 'again')`, [c.id])), "CONFLICT: status");
    expect(await scalar<number>(db, `select count(*)::int from public.messages where campaign_id = $1`, [c.id])).toBe(1);
  });

  it("dispatcher: only the service role claims; failures back off and finally fail; success is recorded", async () => {
    await expectError(asUser(db, manager, (tx) => tx.query(`select * from public.messages_claim(10)`)), "permission denied");
    const claimed = await asService(db, (tx) => tx.query<{ id: string; status: string }>(`select id, status from public.messages_claim(10)`));
    expect(claimed.rows.length).toBe(await scalar<number>(db, `select count(*)::int from public.messages`));
    const [first, second] = claimed.rows;
    await asService(db, (tx) => tx.query(`select public.message_result($1, true, 'log', 'ref-1', null)`, [first!.id]));
    await asService(db, (tx) => tx.query(`select public.message_result($1, false, 'log', null, 'timeout')`, [second!.id]));
    const ok = await scalar<{ status: string; sent_at: string | null }>(db, `select row_to_json(m) from public.messages m where id = $1`, [first!.id]);
    expect(ok.status).toBe("sent");
    expect(ok.sent_at).not.toBeNull();
    const retry = await scalar<{ status: string; run_after: string; last_error: string }>(db, `select row_to_json(m) from public.messages m where id = $1`, [second!.id]);
    expect(retry.status).toBe("queued");
    expect(new Date(retry.run_after).getTime()).toBeGreaterThan(Date.now());
    await db.query(`update public.messages set attempts = 5, status = 'sending' where id = $1`, [second!.id]);
    await asService(db, (tx) => tx.query(`select public.message_result($1, false, 'log', null, 'rejected')`, [second!.id]));
    expect(await scalar<string>(db, `select status::text from public.messages where id = $1`, [second!.id])).toBe("failed");
    await asUser(db, agent, (tx) => tx.query(`select public.message_retry($1)`, [second!.id])).catch(() => undefined);
    // customer_service has no messages.update; the manager does.
    expect(await scalar<string>(db, `select status::text from public.messages where id = $1`, [second!.id])).toBe("failed");
    await asUser(db, manager, (tx) => tx.query(`select public.message_retry($1)`, [second!.id]));
    expect(await scalar<string>(db, `select status::text from public.messages where id = $1`, [second!.id])).toBe("queued");
  });

  it("owners see their own messages; strangers and anon see none", async () => {
    const mine = await asUser(db, citizen, (tx) => tx.query(`select id from public.messages`), "aal1");
    expect(mine.rows.length).toBeGreaterThanOrEqual(3);
    const stranger = await createAuthUser(db, { phone: "+252615550199", fullName: "Stranger" });
    expect((await asUser(db, stranger, (tx) => tx.query(`select id from public.messages`), "aal1")).rows).toHaveLength(0);
    await expectError(as(db, "anon", {}, (tx) => tx.query(`select public.dashboard_kpis()`)), "permission denied");
  });

  it("dashboard and reports: report-only roles see totals; others are refused", async () => {
    const k = await asUser(db, exec, (tx) => scalar<{ finance: { collected_month: number; outstanding: number; overdue: number }; parcels: { registered: number } }>(tx, `select public.dashboard_kpis()`));
    expect(Number(k.finance.collected_month)).toBe(40);
    expect(Number(k.finance.outstanding)).toBe(60);
    expect(Number(k.finance.overdue)).toBe(60);
    expect(k.parcels.registered).toBe(1);
    const arrears = await asUser(db, exec, (tx) => tx.query<{ d31_90: string; total: string }>(`select * from public.report_arrears()`));
    expect(Number(arrears.rows[0]!.d31_90)).toBe(60);
    const rev = await asUser(db, exec, (tx) => tx.query<{ fee_type: string; amount: string }>(`select * from public.report_revenue(current_date - 30, current_date)`));
    expect(rev.rows.find((r) => r.fee_type === "property_tax")?.amount).toBe("40.00");
    const col = await asUser(db, exec, (tx) => tx.query<{ rate: string }>(`select * from public.report_collection(current_date - 365, current_date)`));
    expect(Number(col.rows[0]!.rate)).toBe(40);
    const reg = await asUser(db, exec, (tx) => tx.query<{ registered: string }>(`select * from public.report_registrations(current_date - 30, current_date)`));
    expect(reg.rows.reduce((s, r) => s + Number(r.registered), 0)).toBe(1);
    await expectError(asUser(db, agent, (tx) => tx.query(`select * from public.report_revenue(current_date - 30, current_date)`)), "PERMISSION_DENIED");
    await expectError(asUser(db, exec, (tx) => tx.query(`select * from public.report_revenue(current_date, current_date - 1)`)), "VALIDATION: date_range");
    const tasks = await asUser(db, manager, (tx) => scalar<{ tasks: { messages_failed: number } }>(tx, `select public.dashboard_kpis()`));
    expect(tasks.tasks.messages_failed).toBe(0);
  });
});
