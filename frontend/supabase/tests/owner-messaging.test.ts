import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// Messages to owners: chosen owners or whole areas, check first, then send (0289).
let db: PGlite;
let admin: string;
let clerk: string;
let hodan: string;
let wadajir: string;
let sectionA: string;
let sectorA: string;
let sectorB: string;
let nbA: string;
let nbB: string;
let nbW: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

async function place(district: string, code: string, lon: number) {
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,$2,'S','S') returning id`, [district, `S${code}`]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,$2,'K','K') returning id`, [section, `K${code}`]);
  const nb = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,$2,$3,$3, extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326))) returning id`,
    [sector, code, `Xaafad ${code}`, JSON.stringify(square(lon, 2.04, 0.004))],
  );
  return { section, sector, nb };
}

async function land(surveyor: string, district: string, nb: string, lon: number, name: string, phone: string | null, house: string) {
  return asUser(db, surveyor, (tx) =>
    scalar<{ parcel_id: string }>(tx, `select public.field_land_create($1)`, [
      JSON.stringify({
        district_id: district, neighbourhood_id: nb, pin_lon: lon, pin_lat: 2.04, plot_width_m: 10, plot_length_m: 10,
        property_type: "storey", land_use: "residential", owner_name: name, owner_phone: phone, house_no: house,
      }),
    ]),
  );
}

const preview = (user: string, target: object, body = "Dear {owner_name}, land {property_number} in {neighbourhood_name}.", dup = false, more: object = {}) =>
  asUser(db, user, (tx) =>
    scalar<Record<string, unknown>>(tx, `select public.compose_preview($1)`, [
      JSON.stringify({ target, lang: "en", body, allow_duplicates: dup, ...more }),
    ]),
  );
const send = (user: string, p: object) => asUser(db, user, (tx) => scalar<{ id: string; queued: number }>(tx, `select public.compose_send($1)`, [JSON.stringify(p)]));

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const a = await place(hodan, "101", 45.3);
  const b = await place(hodan, "102", 45.31);
  const w = await place(wadajir, "201", 45.32);
  sectionA = a.section;
  sectorA = a.sector;
  sectorB = b.sector;
  nbA = a.nb;
  nbB = b.nb;
  nbW = w.nb;
  admin = await bootstrapSuperAdmin(db);
  const surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], "all");
  clerk = await createStaff(db, admin, "clerk@gmail.com", ["customer_service"], [hodan]);
  await land(surveyor, hodan, nbA, 45.3, "Cabdi Xasan", "+252615550101", "1");
  const second = await land(surveyor, hodan, nbA, 45.3005, "Cabdi Twin", "+252615550111", "2");
  // Two plots, one owner: the second plot belongs to Cabdi too.
  await db.query(
    `update public.parcel_owners set party_id = (select id from public.parties where full_name = 'Cabdi Xasan') where parcel_id = $1`,
    [second.parcel_id],
  );
  await db.query(`delete from public.parties where full_name = 'Cabdi Twin'`);
  await land(surveyor, hodan, nbA, 45.301, "Faadumo Cali", "+252615550102", "3");
  await land(surveyor, hodan, nbB, 45.31, "Xaliimo Nuur", "+252615550101", "4"); // same phone as Cabdi
  await land(surveyor, hodan, nbB, 45.3105, "Maxamed Bad", "+2526155501", "5"); // too short for Somalia
  await land(surveyor, wadajir, nbW, 45.32, "Wadajir Owner", "+252615550109", "6");
});

describe("messages to owners (0289)", () => {
  it("a district: one row per owner, phones checked, the same phone counted once", async () => {
    const r = await preview(clerk, { districts: [hodan] });
    expect(r).toMatchObject({ owners: 4, valid: 2, invalid: 1, duplicates: 1, missing: 0 });
    expect(String(r.sample)).toMatch(/^Dear (Cabdi Xasan|Faadumo Cali), land /);
  });

  it("the same phone can be texted twice when asked", async () => {
    const r = await preview(clerk, { districts: [hodan] }, "x {owner_name}", true);
    expect(r).toMatchObject({ valid: 3, duplicates: 0 });
  });

  it("a sector or neighbourhood reaches only its own owners", async () => {
    expect(await preview(clerk, { sectors: [sectorB] })).toMatchObject({ owners: 2, valid: 1, invalid: 1 });
    expect(await preview(clerk, { neighbourhoods: [nbA] })).toMatchObject({ owners: 2, valid: 2 });
  });

  it("never outside the user's districts: areas and owners there are refused", async () => {
    await expectError(preview(clerk, { districts: [wadajir] }), "PERMISSION_DENIED");
    await expectError(preview(clerk, { neighbourhoods: [nbW] }), "PERMISSION_DENIED");
    const outsider = await scalar<string>(db, `select id from public.parties where full_name = 'Wadajir Owner'`);
    await expectError(preview(clerk, { owners: [outsider] }), "PERMISSION_DENIED");
    await expectError(preview(clerk, {}), "VALIDATION");
  });

  it("finds owners by name, phone or house number", async () => {
    const byName = await asUser(db, clerk, (tx) => tx.query<{ full_name: string }>(`select full_name from public.compose_search_owners('faadumo')`));
    expect(byName.rows.map((r) => r.full_name)).toEqual(["Faadumo Cali"]);
    const byPhone = await asUser(db, clerk, (tx) => tx.query<{ full_name: string }>(`select full_name from public.compose_search_owners('615550101') order by 1`));
    expect(byPhone.rows.map((r) => r.full_name)).toEqual(["Cabdi Xasan", "Xaliimo Nuur"]);
    const other = await asUser(db, clerk, (tx) => tx.query(`select 1 from public.compose_search_owners('Wadajir')`));
    expect(other.rows).toHaveLength(0);
  });

  it("sends personalised messages, once per phone, and writes the audit log", async () => {
    const out = await send(clerk, { target: { districts: [hodan] }, lang: "en", category: "general", title: "Water", body: "Dear {owner_name}, {property_number}.", expect: 2 });
    expect(out.queued).toBe(2);
    const msgs = await db.query<{ to_address: string; body: string }>(`select to_address, body from public.messages where campaign_id = $1 order by body`, [out.id]);
    expect(msgs.rows).toEqual([
      { to_address: "+252615550101", body: expect.stringMatching(/^Dear Cabdi Xasan, \S+, \S+\.$/) },
      { to_address: "+252615550102", body: expect.stringMatching(/^Dear Faadumo Cali, \S+\.$/) },
    ]);
    const audit = await scalar<number>(db, `select count(*)::int from public.audit_log where action = 'message_send' and record_id = $1`, [out.id]);
    expect(audit).toBe(1);
    const list = await asUser(db, clerk, (tx) => scalar<{ total: number; rows: { state: string; total: number; title: string }[] }>(tx, `select public.campaign_list('{}')`));
    expect(list.rows[0]).toMatchObject({ title: "Water", total: 2, state: "sending" });
  });

  it("refuses when the owners changed since the check", async () => {
    await expectError(send(clerk, { target: { districts: [hodan] }, lang: "en", body: "Hello there", expect: 5 }), "CONFLICT");
  });

  it("a scheduled message waits, and can be stopped", async () => {
    const at = new Date(Date.now() + 3600e3).toISOString();
    const out = await send(clerk, { target: { neighbourhoods: [nbA] }, lang: "so", body: "Salaan {owner_name}", scheduled_at: at });
    const list = await asUser(db, clerk, (tx) => scalar<{ rows: { state: string }[] }>(tx, `select public.campaign_list($1)`, [JSON.stringify({ id: out.id })]));
    expect(list.rows[0]!.state).toBe("scheduled");
    // customer_service may not cancel; the super admin can.
    await expectError(asUser(db, clerk, (tx) => tx.query(`select public.campaign_cancel_waiting($1)`, [out.id])), "PERMISSION_DENIED");
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.campaign_cancel_waiting($1)`, [out.id]))).toBe(2);
  });

  it("failed messages of a campaign can be sent again", async () => {
    const out = await send(admin, { target: { sectors: [sectorA] }, lang: "en", body: "Hi {owner_name}" });
    await db.query(`update public.messages set status = 'failed', last_error = 'gateway' where campaign_id = $1`, [out.id]);
    const before = await asUser(db, admin, (tx) => scalar<{ rows: { state: string; failed: number }[] }>(tx, `select public.campaign_list($1)`, [JSON.stringify({ id: out.id })]));
    expect(before.rows[0]).toMatchObject({ state: "failed", failed: 2 });
    expect(await asUser(db, admin, (tx) => scalar<number>(tx, `select public.campaign_retry_failed($1)`, [out.id]))).toBe(2);
  });

  it("all owners: everyone with land the user looks after, nobody outside", async () => {
    expect(await preview(clerk, { all: true })).toMatchObject({ owners: 4, all: true });
    expect(await preview(admin, { all: true })).toMatchObject({ owners: 5 });
  });

  it("one message per property: Cabdi's two plots get one message each", async () => {
    const r = await preview(clerk, { neighbourhoods: [nbA] }, "{ParcelID}", false, { per_parcel: true });
    expect(r).toMatchObject({ owners: 2, messages: 3, valid: 3 });
    const out = await send(clerk, { target: { neighbourhoods: [nbA] }, lang: "en", body: "Land {ParcelID} owes {Balance}", per_parcel: true, expect: 3 });
    const bodies = await db.query<{ body: string; related_kind: string }>(`select body, related_kind from public.messages where campaign_id = $1 order by body`, [out.id]);
    expect(bodies.rows).toHaveLength(3);
    expect(bodies.rows.every((b) => b.related_kind === "parcel" && /^Land \S+ owes \d+\.\d\d USD$/.test(b.body))).toBe(true);
  });

  it("the {OwnerName} style works too", async () => {
    const r = await preview(clerk, { owners: [await scalar<string>(db, `select id from public.parties where full_name = 'Faadumo Cali'`)] }, "Hi {OwnerName} in {District}");
    expect(r.sample).toBe("Hi Faadumo Cali in Hodan");
    expect((r.sample_vars as Record<string, string>).OwnerName).toBe("Faadumo Cali");
  });

  it("email goes to the owner's email, with the title as subject", async () => {
    await db.query(`update public.parties set email = 'faadumo@example.com' where full_name = 'Faadumo Cali'`);
    await db.query(`update public.parties set email = 'not an email' where full_name = 'Xaliimo Nuur'`);
    const r = await preview(clerk, { districts: [hodan] }, "x", false, { channel: "email" });
    expect(r).toMatchObject({ owners: 4, valid: 1, invalid: 1, missing: 2 });
    const out = await send(clerk, { target: { districts: [hodan] }, lang: "en", channel: "email", title: "Tax", body: "Dear {OwnerName}", expect: 1 });
    const m = await db.query<{ channel: string; to_address: string; subject: string }>(`select channel, to_address, subject from public.messages where campaign_id = $1`, [out.id]);
    expect(m.rows).toEqual([{ channel: "email", to_address: "faadumo@example.com", subject: "Tax" }]);
  });

  it("a user limited to one sector reaches only that sector", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_areas($1, $2)`, [clerk, JSON.stringify([{ level: "sector", id: sectorB }])]));
    await expectError(preview(clerk, { districts: [hodan] }), "PERMISSION_DENIED");
    await expectError(preview(clerk, { sections: [sectionA] }), "PERMISSION_DENIED");
    await expectError(preview(clerk, { neighbourhoods: [nbA] }), "PERMISSION_DENIED");
    expect(await preview(clerk, { neighbourhoods: [nbB] })).toMatchObject({ owners: 2 });
    // Choosing an owner who also has land elsewhere only counts the land in their area.
    const cabdi = await scalar<string>(db, `select id from public.parties where full_name = 'Cabdi Xasan'`);
    await expectError(preview(clerk, { owners: [cabdi] }), "PERMISSION_DENIED");
    // The area picker opens the way down to the sector, and only the sector can be chosen.
    const districts = await asUser(db, clerk, (tx) => tx.query<{ id: string; allowed: boolean }>(`select id, allowed from public.compose_areas('district')`));
    expect(districts.rows).toEqual([{ id: hodan, allowed: false }]);
    const sectors = await asUser(db, clerk, (tx) => tx.query<{ id: string; allowed: boolean; owners: number }>(`select id, allowed, owners from public.compose_areas('sector', (select section_id from public.sectors where id = $1))`, [sectorB]));
    expect(sectors.rows).toEqual([{ id: sectorB, allowed: true, owners: 2 }]);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_areas($1, '[]')`, [clerk]));
    expect(await preview(clerk, { districts: [hodan] })).toMatchObject({ owners: 4 });
  });
});
