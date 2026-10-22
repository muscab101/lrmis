import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createAuthUser, createDb, createStaff, letClerksCreate, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let clerkHodan: string;
let clerkWadajir: string;
let landOfficer: string;
let citizen: string;
let otherCitizen: string;
let hodan: string;
let wadajir: string;
let nbhdHodan: string;
let ownerA: string;
let ownerB: string;
let appId: string;
let appNumber: string;

const PIN_IN = { pin_lon: 45.3, pin_lat: 2.04 }; // inside the Hodan test neighbourhood

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhdHodan = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04))],
  );
  admin = await bootstrapSuperAdmin(db);
  clerkHodan = await createStaff(db, admin, "desk.hodan@gmail.com", ["front_desk_clerk"], [hodan]);
  clerkWadajir = await createStaff(db, admin, "desk.wadajir@gmail.com", ["front_desk_clerk"], [wadajir]);
  await letClerksCreate(db);
  landOfficer = await createStaff(db, admin, "land@gmail.com", ["land_officer"], [hodan]);
  citizen = await createAuthUser(db, { phone: "+252615551234", fullName: "Faadumo Cali" });
  otherCitizen = await createAuthUser(db, { phone: "+252615559999" });
});

describe("owners and duplicate checks", () => {
  it("front desk registers owners; the same ID document cannot be registered twice", async () => {
    ownerA = await asUser(db, clerkHodan, (tx) =>
      scalar<string>(tx, `select public.save_party(null, $1)`, [
        JSON.stringify({ full_name: "Cabdi Xasan Maxamed", mother_name: "Hodan Cali", id_type: "national_id", id_number: "so 123 456", phone: "+252611112222", district_id: hodan }),
      ]),
    );
    ownerB = await asUser(db, clerkHodan, (tx) =>
      scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: "Ayaan Xasan", district_id: hodan })]),
    );
    await expectError(
      asUser(db, clerkHodan, (tx) =>
        tx.query(`select public.save_party(null, $1)`, [JSON.stringify({ full_name: "Someone Else", id_type: "national_id", id_number: "SO123456" })]),
      ),
      "CONFLICT: id_number",
    );
  });

  it("finds possible duplicates by phone and similar name + mother's name", async () => {
    const r = await asUser(db, clerkHodan, (tx) =>
      scalar<{ count: number; matches: { id: string; reasons: string[] }[] }>(
        tx,
        `select public.find_duplicate_parties('Cabdi Xasan Maxamad', 'Hodan Cali', null, null, '+252611112222')`,
      ),
    );
    expect(r.count).toBe(1);
    expect(r.matches[0]?.reasons.sort()).toEqual(["same_phone", "similar_name"]);
  });

  it("citizens only learn that a duplicate exists, never who", async () => {
    const r = await asUser(
      db,
      citizen,
      (tx) => scalar<Record<string, unknown>>(tx, `select public.find_duplicate_parties('x', null, 'national_id', 'SO123456', null)`),
      "aal1",
    );
    expect(r).toEqual({ count: 1, reasons: ["same_id"] });
  });

  it("district staff cannot see owners registered in another district", async () => {
    const n = await asUser(db, clerkWadajir, (tx) => scalar<number>(tx, `select count(*)::int from public.parties where id = $1`, [ownerA]));
    expect(n).toBe(0);
  });
});

describe("application lifecycle", () => {
  it("creates a draft; the neighbourhood is found from the pin", async () => {
    const r = await asUser(db, clerkHodan, (tx) =>
      scalar<{ id: string; number: string }>(tx, `select public.application_create($1)`, [
        JSON.stringify({ type: "new_registration", channel: "office", district_id: hodan, ...PIN_IN, address_note: "Near Taleex junction" }),
      ]),
    );
    appId = r.id;
    appNumber = r.number;
    expect(appNumber).toMatch(/^APP-\d{4}-\d{6}$/);
    const row = await scalar<{ neighbourhood_id: string; status: string }>(
      db,
      `select jsonb_build_object('neighbourhood_id', neighbourhood_id, 'status', status) from public.applications where id = $1`,
      [appId],
    );
    expect(row).toEqual({ neighbourhood_id: nbhdHodan, status: "draft" });
  });

  it("rejects a pin outside the chosen neighbourhood and other districts", async () => {
    await expectError(
      asUser(db, clerkHodan, (tx) =>
        tx.query(`select public.application_create($1)`, [
          JSON.stringify({ district_id: hodan, neighbourhood_id: nbhdHodan, pin_lon: 45.35, pin_lat: 2.06 }),
        ]),
      ),
      "VALIDATION: pin_outside_neighbourhood",
    );
    await expectError(
      asUser(db, clerkHodan, (tx) => tx.query(`select public.application_create($1)`, [JSON.stringify({ district_id: wadajir })])),
      "DISTRICT_OUT_OF_SCOPE",
    );
  });

  it("the checklist blocks submission until owners, shares and documents are complete", async () => {
    const before = await asUser(db, clerkHodan, (tx) => scalar<{ code: string }[]>(tx, `select public.application_checklist($1)`, [appId]));
    expect(before.map((p) => p.code).sort()).toEqual(["missing_document", "missing_document", "no_owner"]);
    await expectError(asUser(db, clerkHodan, (tx) => tx.query(`select public.application_submit($1)`, [appId])), "VALIDATION: checklist");

    await asUser(db, clerkHodan, (tx) =>
      tx.query(`select public.application_set_parties($1, $2)`, [
        appId,
        JSON.stringify([
          { party_id: ownerA, role: "owner", share_pct: 60 },
          { party_id: ownerB, role: "co_owner", share_pct: 30 },
        ]),
      ]),
    );
    const shares = await asUser(db, clerkHodan, (tx) => scalar<{ code: string; value: number }[]>(tx, `select public.application_checklist($1)`, [appId]));
    expect(shares.find((p) => p.code === "shares_not_100")?.value).toBe(90);

    await asUser(db, clerkHodan, async (tx) => {
      await tx.query(`select public.application_set_parties($1, $2)`, [
        appId,
        JSON.stringify([
          { party_id: ownerA, role: "owner", share_pct: 60 },
          { party_id: ownerB, role: "co_owner", share_pct: 40 },
        ]),
      ]);
      await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 1000)`, [appId, `${appId}/id.pdf`]);
      await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'deed.jpg', 'image/jpeg', 2000)`, [appId, `${appId}/deed.jpg`]);
    });
    expect(await asUser(db, clerkHodan, (tx) => scalar(tx, `select public.application_checklist($1)`, [appId]))).toEqual([]);
  });

  it("documents must be stored under the application's own folder", async () => {
    await expectError(
      asUser(db, clerkHodan, (tx) => tx.query(`select public.application_add_document($1, 'other', 'elsewhere/x.pdf', 'x.pdf', 'application/pdf', 10)`, [appId])),
      "VALIDATION: storage_path",
    );
  });

  it("submits → straight to review (payment comes last); the application is then locked for edits", async () => {
    const r = await asUser(db, clerkHodan, (tx) => scalar<{ status: string }>(tx, `select public.application_submit($1)`, [appId]));
    expect(r.status).toBe("in_survey");
    await expectError(asUser(db, clerkHodan, (tx) => tx.query(`select public.application_update($1, '{}')`, [appId])), "CONFLICT: not editable");
  });

  it("a land officer returns it with a reason; it can be fixed and resubmitted", async () => {
    await expectError(asUser(db, landOfficer, (tx) => tx.query(`select public.application_transition($1, 'return', '')`, [appId])), "VALIDATION: note_required");
    await asUser(db, landOfficer, (tx) => tx.query(`select public.application_transition($1, 'return', 'Deed copy unreadable')`, [appId]));
    await asUser(db, clerkHodan, (tx) => tx.query(`select public.application_update($1, '{"address_note":"Near Taleex junction, blue gate"}')`, [appId]));
    await asUser(db, clerkHodan, (tx) => tx.query(`select public.application_submit($1)`, [appId]));
    const actions = await db.query<{ action: string }>(`select action from public.application_events where application_id = $1 order by id`, [appId]);
    expect(actions.rows.map((r) => r.action)).toEqual([
      "created",
      "document_added",
      "document_added",
      "submitted",
      "return",
      "resubmitted",
    ]);
  });

  it("only roles with applications.approve can reject", async () => {
    await expectError(asUser(db, clerkHodan, (tx) => tx.query(`select public.application_transition($1, 'reject', 'no')`, [appId])), "PERMISSION_DENIED");
  });

  it("staff of another district cannot see the application", async () => {
    expect(await asUser(db, clerkWadajir, (tx) => scalar<number>(tx, `select count(*)::int from public.applications where id = $1`, [appId]))).toBe(0);
    expect(await asUser(db, clerkWadajir, (tx) => scalar(tx, `select public.application_document_path(d.id) from public.application_documents d limit 1`).catch(() => null))).toBeNull();
  });
});

describe("citizen portal", () => {
  let citizenApp: string;

  it("a citizen applies online and becomes the 100% owner", async () => {
    const r = await asUser(
      db,
      citizen,
      (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, ...PIN_IN, channel: "office" })]),
      "aal1",
    );
    citizenApp = r.id;
    const row = await db.query<{ channel: string; role: string; share_pct: string }>(
      `select a.channel, ap.role, ap.share_pct from public.applications a join public.application_parties ap on ap.application_id = a.id where a.id = $1`,
      [citizenApp],
    );
    expect(row.rows[0]).toMatchObject({ channel: "portal", role: "owner" });
    expect(Number(row.rows[0]?.share_pct)).toBe(100);
  });

  it("other citizens cannot see it; district staff can", async () => {
    expect(await asUser(db, otherCitizen, (tx) => scalar<number>(tx, `select count(*)::int from public.applications`), "aal1")).toBe(0);
    expect(await asUser(db, clerkHodan, (tx) => scalar<number>(tx, `select count(*)::int from public.applications where id = $1`, [citizenApp]))).toBe(1);
  });

  it("flags another application within 10 m of the same pin", async () => {
    const near = await asUser(db, clerkHodan, (tx) => tx.query<{ number: string; distance_m: number }>(`select * from public.application_nearby($1)`, [appId]));
    expect(near.rows).toHaveLength(1);
    expect(near.rows[0]?.distance_m).toBeLessThan(1);
  });

  it("the applicant can cancel a draft", async () => {
    await asUser(db, citizen, (tx) => tx.query(`select public.application_transition($1, 'cancel')`, [citizenApp]), "aal1");
    expect(await scalar(db, `select status from public.applications where id = $1`, [citizenApp])).toBe("cancelled");
  });
});

describe("public tracking", () => {
  it("shows status with the number + last 4 phone digits, nothing otherwise", async () => {
    const ok = await as(db, "anon", {}, (tx) =>
      scalar<{ status: string; events: unknown[] } | null>(tx, `select public.application_track($1, '2222')`, [appNumber.toLowerCase()]),
    );
    expect(ok?.status).toBe("in_survey");
    expect(JSON.stringify(ok)).not.toContain("Cabdi");
    const wrong = await as(db, "anon", {}, (tx) => scalar(tx, `select public.application_track($1, '0000')`, [appNumber]));
    expect(wrong).toBeNull();
  });

  it("anonymous visitors cannot read applications or parties directly", async () => {
    await expect(as(db, "anon", {}, (tx) => tx.query(`select * from public.applications`))).rejects.toThrow(/permission denied/);
    await expect(as(db, "anon", {}, (tx) => tx.query(`select * from public.parties`))).rejects.toThrow(/permission denied/);
  });
});
