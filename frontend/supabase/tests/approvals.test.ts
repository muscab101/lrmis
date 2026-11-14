import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let registrar: string;
let billing: string;
let draftLand: string;
let draftOwner: string;

type Item = { kind: string; id: string; ref: string | null; mine: boolean; href: string };
const inbox = (user: string) => asUser(db, user, (tx) => scalar<{ items: Item[] }>(tx, `select public.approvals_inbox()`)).then((r) => r.items);
const decide = (user: string, kind: string, id: string, approve: boolean, note: string | null = null) =>
  asUser(db, user, (tx) => tx.query(`select public.approval_decide($1, $2, $3, $4)`, [kind, id, approve, note]));

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
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
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [hodan]);
  billing = await createStaff(db, admin, "billing@gmail.com", ["billing_officer"], [hodan]);
  draftLand = await scalar<string>(
    db,
    `insert into public.parcels (district_id, neighbourhood_id, house_no, land_use, area_m2, geom, status)
     values ($1, $2, '41', 'residential', 100, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), 'draft') returning id`,
    [hodan, nbhd, JSON.stringify(square(45.3, 2.04, 0.0001))],
  );
  draftOwner = await scalar<string>(db, `insert into public.parties (full_name, phone, district_id) values ('Waiting Owner', '+252611111112', $1) returning id`, [hodan]);
});

describe("applications: one inbox for everything waiting for approval", () => {
  it("every part of the inbox runs; each item says its district and carries facts; each person sees only what they may approve", async () => {
    const hodan = await scalar<string>(db, `select id from public.districts where code = 'HDN'`);
    const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDNA', 'Hodan desk', $1, 'HDNA') returning id`, [hodan]);
    const shift = await scalar<string>(
      db,
      `insert into public.cashier_shifts (number, pos_id, cashier_id, district_id, opening_float, closed_at, expected_cash, counted_cash, difference, status)
       values ('SH-1', $1, $2, $3, 0, now(), 100, 95, -5, 'closed') returning id`,
      [pos, billing, hodan],
    );
    const all = await inbox(admin);
    const item = all.find((i) => i.id === shift) as Item & { district: { code: string }; facts: Record<string, unknown> };
    expect(item.kind).toBe("shift");
    expect(item.district.code).toBe("HDN");
    expect(item.facts).toMatchObject({ desk: "Hodan desk", expected_usd: 100, counted_usd: 95 });
    // Land registers by itself once paid, and owners with it: neither waits for an approval.
    expect(all.some((i) => i.kind === "land_register" || i.kind === "owner")).toBe(false);
    // A registrar approves no money.
    expect((await inbox(registrar)).some((i) => i.kind === "shift")).toBe(false);
  });

  it("approve goes through each kind's own step, with its own power check", async () => {
    await expectError(decide(billing, "owner", draftOwner, true), "PERMISSION_DENIED");
    await decide(registrar, "owner", draftOwner, true);
    expect(await scalar<string | null>(db, `select registered_at::text from public.parties where id = $1`, [draftOwner])).not.toBeNull();
    expect((await inbox(registrar)).some((i) => i.id === draftOwner)).toBe(false);
    // Turning down an approve-only kind is refused; the extra facts reach the step that needs them.
    await expectError(decide(registrar, "pos_payments", draftOwner, false, "no"), "CONFLICT: open_to_decide");
  });

  it("turning down needs a reason, and some kinds are decided on their own page", async () => {
    await expectError(decide(registrar, "land_change", draftLand, false), "VALIDATION: note_required");
    await expectError(decide(registrar, "land_register", draftLand, false, "no"), "CONFLICT: open_to_decide");
    await expectError(decide(registrar, "nothing", draftLand, true), "VALIDATION: kind");
  });
});

describe("approving your own work", () => {
  it("is refused, except for a Super Admin named in security.self_approve_users", async () => {
    const hodan = await scalar<string>(db, `select id from public.districts where code = 'HDN'`);
    const pos = await scalar<string>(db, `select id from public.points_of_sale where code = 'HDNA'`);
    const own = (n: string) =>
      scalar<string>(
        db,
        `insert into public.cashier_shifts (number, pos_id, cashier_id, district_id, opening_float, closed_at, expected_cash, counted_cash, difference, status)
         values ($1, $2, $3, $4, 0, now(), 0, 0, 0, 'closed') returning id`,
        [n, pos, admin, hodan],
      );
    const a = await own("SH-OWN-1");
    await expectError(decide(admin, "shift", a, true), "MAKER_CHECKER");
    await db.query(`update public.settings set value = jsonb_build_array($1::text) where key = 'security.self_approve_users'`, [admin]);
    await decide(admin, "shift", a, true);
    expect(await scalar<string>(db, `select status from public.cashier_shifts where id = $1`, [a])).toBe("approved");
    await db.query(`update public.settings set value = '[]' where key = 'security.self_approve_users'`);
  });
});
