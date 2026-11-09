import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let officer: string;
let hodan: string;
let parcel: string;
let cert: string;
let printer: string;
let key: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

const details = (extra: Record<string, unknown> = {}) => ({
  name: "Registry printer",
  manufacturer: "HP",
  model: "M404",
  serial_no: "phcb-12345",
  mac_address: "aa-bb-cc-dd-ee-01",
  ip_address: "192.168.1.50",
  connection_type: "ethernet",
  system_name: "HP_M404",
  location: "Registry office",
  // Each district prints on its own printer: the test certificates are in Hodan.
  district_id: hodan,
  ...extra,
});
const agent = <T>(sql: string, params: unknown[]) => as(db, "anon", {}, (tx) => scalar<T>(tx, sql, params));
type Claim = { ok: boolean; error?: string; blocked: string | null; job: { id: string; token: string } | null };
const claim = (k: string, ip = "10.0.0.5", info: Record<string, unknown> = {}) =>
  agent<Claim>(`select public.agent_claim_job($1, $2, $3)`, [k, ip, JSON.stringify(info)]);
const alerts = async (kind: string) => scalar<number>(db, `select count(*)::int from public.printer_alerts where kind = $1 and resolved_at is null`, [kind]);

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  officer = await createStaff(db, admin, "printer@gmail.com", ["print_officer"], [hodan]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  const nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  parcel = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, land_use, area_m2, geom, status, registered_at)
     values ('HDN01201', 'HDN0000001', $1, $2, 'residential', 100, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'registered', now()) returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  cert = await scalar<string>(
    db,
    `insert into public.issued_documents (type, serial, parcel_id, district_id, verify_code, snapshot) values ('certificate', 'CERT-1', $1, $2, 'code-1', '{}') returning id`,
    [parcel, hodan],
  );
});

describe("add printer", () => {
  it("only those allowed can add a printer; details are cleaned and checked", async () => {
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.printer_save($1)`, [JSON.stringify(details())])), "PERMISSION_DENIED");
    printer = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.printer_save($1)`, [JSON.stringify(details())]));
    const p = await scalar<{ code: string; serial_no: string; mac_address: string }>(db, `select row_to_json(p) from public.printers p where id = $1`, [printer]);
    expect(p).toMatchObject({ code: "PRN-0001", serial_no: "PHCB-12345", mac_address: "AA:BB:CC:DD:EE:01" });
    const save = (d: Record<string, unknown>) => asUser(db, admin, (tx) => tx.query(`select public.printer_save($1)`, [JSON.stringify(details(d))]));
    await expectError(save({ serial_no: "x" }), "VALIDATION: serial_no");
    await expectError(save({ serial_no: "NEW-1", mac_address: "nope" }), "VALIDATION: mac_address");
    await expectError(save({ serial_no: "NEW-1", mac_address: "AA:BB:CC:DD:EE:02", ip_address: "999.1.1.1" }), "VALIDATION: ip_address");
    await expectError(save({ serial_no: "NEW-1", mac_address: "" }), "VALIDATION: mac_address");
  });

  it("refuses the same serial, MAC or IP twice", async () => {
    const save = (d: Record<string, unknown>) => asUser(db, admin, (tx) => tx.query(`select public.printer_save($1)`, [JSON.stringify(details(d))]));
    await expectError(save({}), "VALIDATION: serial_taken");
    await expectError(save({ serial_no: "NEW-2" }), "VALIDATION: mac_taken");
    await expectError(save({ serial_no: "NEW-2", mac_address: "AA:BB:CC:DD:EE:02" }), "VALIDATION: ip_taken");
  });

  it("a USB printer needs no MAC or IP", async () => {
    const id = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.printer_save($1)`, [JSON.stringify(details({ serial_no: "USB-1", mac_address: "", ip_address: "", connection_type: "usb" }))]));
    expect(id).toBeTruthy();
  });

  it("the key is shown once and only its hash is kept; staff cannot read printers directly", async () => {
    key = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.printer_new_key($1)`, [printer]));
    expect(key).toMatch(/^lrmis_pa_[0-9a-f]{64}$/);
    expect(await scalar<string>(db, `select key_hash from public.printer_keys where printer_id = $1`, [printer])).not.toContain(key);
    const direct = await asUser(db, officer, (tx) => tx.query(`select * from public.printer_keys`));
    expect(direct.rows).toHaveLength(0);
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.printer_new_key($1)`, [printer])), "PERMISSION_DENIED");
  });
});

describe("certificates print only on added printers", () => {
  it("the browser path is closed", async () => {
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.document_print($1)`, [cert])), "CONFLICT: use_printer");
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.document_print_bulk($1)`, [[cert]])), "CONFLICT: use_printer");
  });

  it("refuses a printer that is unknown, has no key, or is switched off", async () => {
    const send = (p: string) => asUser(db, officer, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [cert, p]));
    await expectError(send("00000000-0000-4000-8000-000000000000"), "CONFLICT: printer_not_allowed");
    const noKey = await scalar<string>(db, `select id from public.printers where serial_no = 'USB-1'`);
    await expectError(send(noKey), "CONFLICT: printer_not_allowed");
    await asUser(db, admin, (tx) => tx.query(`select public.printer_set_active($1, false)`, [printer]));
    await expectError(send(printer), "CONFLICT: printer_not_allowed");
    await asUser(db, admin, (tx) => tx.query(`select public.printer_set_active($1, true)`, [printer]));
    const choices = await asUser(db, officer, (tx) => tx.query<{ id: string }>(`select * from public.printer_choices()`));
    expect(choices.rows.map((r) => r.id)).toEqual([printer]);
  });

  it("a certificate prints only on its own district's printer, and only that printer is offered", async () => {
    const other = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) select region_id, 'OTH', 'Other', 'Other' from public.districts where id = $1 returning id`, [hodan]);
    const away = await asUser(db, admin, (tx) =>
      scalar<string>(tx, `select public.printer_save($1)`, [JSON.stringify(details({ serial_no: "AWAY-1", mac_address: "", ip_address: "", connection_type: "usb", district_id: other }))]),
    );
    await db.query(`insert into public.printer_keys (printer_id, key_hash) values ($1, 'away-key-hash')`, [away]);
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [cert, away])), "CONFLICT: printer_wrong_district");
    const hodanOnly = await asUser(db, admin, (tx) => tx.query<{ id: string }>(`select * from public.printer_choices($1)`, [hodan]));
    expect(hodanOnly.rows.map((r) => r.id)).toEqual([printer]);
    await db.query(`delete from public.printer_keys where printer_id = $1`, [away]);
    await db.query(`delete from public.printers where id = $1`, [away]);
    await db.query(`delete from public.districts where id = $1`, [other]);
  });

  it("a wrong key gets nothing and raises one alert per address", async () => {
    expect((await claim("wrong-key", "41.1.1.1")).error).toBe("bad_key");
    await claim("wrong-key", "41.1.1.1");
    expect(await alerts("bad_key")).toBe(1);
    expect(await agent(`select public.agent_job_document($1)`, ["not-a-token"])).toBeNull();
  });

  it("a job goes through the queue: one at a time, counted only when reported printed", async () => {
    const job = await asUser(db, officer, (tx) => scalar<string>(tx, `select public.document_send_to_printer($1, $2)`, [cert, printer]));
    await expectError(asUser(db, officer, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [cert, printer])), "CONFLICT: already_queued");
    const c = await claim(key);
    expect(c.job!.id).toBe(job);
    const page = await agent<{ doc: { serial: string } }>(`select public.agent_job_document($1)`, [c.job!.token]);
    expect(page.doc.serial).toBe("CERT-1");
    expect(await scalar<number>(db, `select print_count from public.issued_documents where id = $1`, [cert])).toBe(0);
    await agent(`select public.agent_report_job($1, $2, false, 'Paper jam')`, [key, job]);
    expect(await scalar<number>(db, `select print_count from public.issued_documents where id = $1`, [cert])).toBe(0);
    expect(await agent(`select public.agent_job_document($1)`, [c.job!.token])).toBeNull();

    // Failed: it can be sent again, and is counted once printed.
    const again = await asUser(db, officer, (tx) => scalar<string>(tx, `select public.document_send_to_printer($1, $2)`, [cert, printer]));
    await claim(key);
    const usb = await scalar<string>(db, `select id from public.printers where serial_no = 'USB-1'`);
    const otherKey = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.printer_new_key($1)`, [usb]));
    expect((await agent<{ error: string }>(`select public.agent_report_job($1, $2, true)`, [otherKey, again])).error).toBe("not_found");
    await agent(`select public.agent_report_job($1, $2, true)`, [key, again]);
    expect(await scalar<number>(db, `select print_count from public.issued_documents where id = $1`, [cert])).toBe(1);
    expect(await asUser(db, officer, (tx) => scalar<{ status: string }>(tx, `select row_to_json(s) from public.document_print_status($1) s`, [[cert]]))).toMatchObject({ status: "printed" });
  });

  it("stops and warns when the printer's network details or the computer change", async () => {
    await db.query(`update public.issued_documents set print_count = 0 where id = $1`, [cert]);
    const job = await asUser(db, officer, (tx) => scalar<string>(tx, `select public.document_send_to_printer($1, $2)`, [cert, printer]));
    const wrongMac = await claim(key, "10.0.0.5", { printer_mac: "AA:BB:CC:DD:EE:99" });
    expect(wrongMac).toMatchObject({ blocked: "network_changed", job: null });
    expect(await alerts("network_changed")).toBe(1);
    const missing = await claim(key, "10.0.0.5", { printers: ["Other printer"] });
    expect(missing).toMatchObject({ blocked: "printer_missing", job: null });
    await claim(key, "10.0.0.9", { printers: ["HP_M404"], printer_mac: "AA:BB:CC:DD:EE:01" }).then((c) => expect(c.job!.id).toBe(job));
    expect(await alerts("agent_moved")).toBe(1);
    await agent(`select public.agent_report_job($1, $2, true)`, [key, job]);
  });

  it("a switched-off printer gets no jobs, its waiting jobs fail, and using it raises an alert", async () => {
    await db.query(`update public.issued_documents set print_count = 0 where id = $1`, [cert]);
    const job = await asUser(db, officer, (tx) => scalar<string>(tx, `select public.document_send_to_printer($1, $2)`, [cert, printer]));
    await asUser(db, admin, (tx) => tx.query(`select public.printer_set_active($1, false)`, [printer]));
    expect(await scalar<string>(db, `select status from public.printer_queue where id = $1`, [job])).toBe("failed");
    expect(await claim(key, "10.0.0.9")).toMatchObject({ blocked: "inactive", job: null });
    expect(await alerts("inactive_printer_used")).toBe(1);
  });

  it("the print program can open an ID card, with its district outlines, without a person signed in", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.printer_set_active($1, true)`, [printer]));
    const party = await scalar<string>(db, `insert into public.parties (kind, full_name, district_id) values ('person', 'Xaawo Cali', $1) returning id`, [hodan]);
    const card = await scalar<string>(
      db,
      `insert into public.issued_documents (type, serial, parcel_id, party_id, district_id, verify_code, snapshot) values ('id_card', 'IDC-1', $1, $2, $3, 'code-2', '{}') returning id`,
      [parcel, party, hodan],
    );
    await asUser(db, officer, (tx) => tx.query(`select public.document_send_to_printer($1, $2)`, [card, printer]));
    const c = await claim(key, "10.0.0.9");
    const page = await agent<{ doc: { serial: string }; outlines: unknown }>(`select public.agent_job_document($1)`, [c.job!.token]);
    expect(page.doc.serial).toBe("IDC-1");
    expect(page).toHaveProperty("outlines");
    await agent(`select public.agent_report_job($1, $2, false)`, [key, c.job!.id]);
  });

  it("a new key stops the old one", async () => {
    const fresh = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.printer_new_key($1)`, [printer]));
    expect((await claim(key)).error).toBe("bad_key");
    expect((await claim(fresh, "10.0.0.9")).ok).toBe(true);
  });
});
