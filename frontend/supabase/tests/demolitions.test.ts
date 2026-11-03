import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let surveyor: string;
let registrar: string;
let otherRegistrar: string;
let cashier: string;
let district: string;
let otherDistrict: string;
let neighbourhood: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const today = new Date().toISOString().slice(0, 10);
const base = (house: string) => ({ district_id: district, neighbourhood_id: neighbourhood, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 10, plot_length_m: 20, property_type: "brick", land_use: "residential", house_no: house });
const house = async (no: string, owner = "Owner " + no) => {
  const r = await asUser(db, surveyor, (tx) => scalar<{ parcel_id: string; pun: string }>(tx, `select public.field_land_create($1)`, [JSON.stringify({ ...base(no), owner_name: owner })]));
  await asUser(db, registrar, (tx) => tx.query(`select public.parcel_register($1)`, [r.parcel_id]));
  return r;
};
const units = async (layout: "flats" | "compound", no: string) => {
  const r = await asUser(db, surveyor, (tx) =>
    scalar<{ parcel_id: string; pun: string }>(tx, `select public.land_with_units_create($1)`, [
      JSON.stringify({ ...base(no), layout, floors: 2, units: [{ unit_no: "01", floor: 0, own_m2: 50, owner_name: `Unit One ${no}` }, { unit_no: "02", floor: 1, own_m2: 50, owner_name: `Unit Two ${no}` }] }),
    ]),
  );
  await asUser(db, registrar, (tx) => tx.query(`select public.parcel_register($1)`, [r.parcel_id]));
  return r;
};
const ask = (user: string, ids: string[], extra: Record<string, unknown> = {}) =>
  asUser(db, user, (tx) => scalar<{ count: number; approved: boolean }>(tx, `select public.demolition_request($1)`, [JSON.stringify({ parcel_ids: ids, demolition_date: today, reason: "Road widening works", demolished_by: "Municipality", ...extra })]));
const demolitionOf = (parcel: string) => scalar<string>(db, `select id from public.demolitions where parcel_id = $1 order by requested_at desc limit 1`, [parcel]);
const parcel = (id: string) => scalar<{ pun: string; house_no: string; building_state: string; property_type: string; status: string; layout: string; building_no: string | null }>(db, `select row_to_json(p) from (select pun, house_no, building_state, property_type, status, layout, building_no from public.parcels where id = $1) p`, [id]);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  otherDistrict = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  neighbourhood = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom) values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`, [sector, JSON.stringify(square(45.3, 2.04))]);
  await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('brick','Guri','Brick', 0.25), ('emptyland','Bannaan','Empty Land', 0.10)`);
  admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [district]);
  registrar = await createStaff(db, admin, "registrar@gmail.com", ["registrar"], [district]);
  otherRegistrar = await createStaff(db, admin, "registrar2@gmail.com", ["registrar"], [otherDistrict]);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [district]);
});

describe("asking and approving", () => {
  it("a surveyor asks and nothing changes until it's approved; the approver is told", async () => {
    const h = await house("01");
    const r = await ask(surveyor, [h.parcel_id]);
    expect(r).toMatchObject({ count: 1, approved: false });
    expect((await parcel(h.parcel_id)).building_state).toBe("standing");
    expect(await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'demolition.request'`, [registrar])).toBe(1);
    await expectError(ask(surveyor, [h.parcel_id]), "CONFLICT: demolish_waiting");
    const id = await demolitionOf(h.parcel_id);
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.demolition_decide($1, true, null)`, [[id]])), "PERMISSION_DENIED");
    await expectError(asUser(db, otherRegistrar, (tx) => tx.query(`select public.demolition_decide($1, true, null)`, [[id]])), "NOT_FOUND");
    await asUser(db, registrar, (tx) => tx.query(`select public.demolition_decide($1, true, null)`, [[id]]));
    const p = await parcel(h.parcel_id);
    expect(p).toMatchObject({ building_state: "demolished", property_type: "emptyland", house_no: "01", status: "registered" });
  });

  it("only those allowed can mark at once; a rejection needs a reason and changes nothing", async () => {
    const h = await house("02");
    await expectError(ask(surveyor, [h.parcel_id], { approve_now: true }), "PERMISSION_DENIED");
    await expectError(ask(cashier, [h.parcel_id]), "PERMISSION_DENIED");
    await ask(surveyor, [h.parcel_id]);
    const id = await demolitionOf(h.parcel_id);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.demolition_decide($1, false, 'no')`, [[id]])), "VALIDATION: reason");
    await asUser(db, registrar, (tx) => tx.query(`select public.demolition_decide($1, false, 'The house is still there')`, [[id]]));
    expect((await parcel(h.parcel_id)).building_state).toBe("standing");
    expect(await ask(registrar, [h.parcel_id], { approve_now: true })).toMatchObject({ approved: true });
    expect((await parcel(h.parcel_id)).building_state).toBe("demolished");
  });

  it("checks the date, reason, and that the land can be marked", async () => {
    const h = await house("03");
    await expectError(ask(registrar, [h.parcel_id], { demolition_date: "2999-01-01" }), "VALIDATION: demolish_date");
    await expectError(ask(registrar, [h.parcel_id], { reason: "no" }), "VALIDATION: reason");
    await expectError(ask(registrar, []), "VALIDATION: demolish_selection");
    await ask(registrar, [h.parcel_id], { approve_now: true });
    await expectError(ask(registrar, [h.parcel_id]), "CONFLICT: demolish_already");
  });

  it("a whole neighbourhood can be marked together, and nothing is half done on a failure", async () => {
    const a = await house("04");
    const b = await house("05");
    const candidates = await asUser(db, surveyor, (tx) => tx.query<{ id: string }>(`select * from public.demolition_candidates(null, null, null, $1, '')`, [neighbourhood]));
    expect(candidates.rows.map((r) => r.id)).toEqual(expect.arrayContaining([a.parcel_id, b.parcel_id]));
    await expect(ask(registrar, [a.parcel_id, b.parcel_id, "00000000-0000-4000-8000-000000000000"], { approve_now: true })).rejects.toThrow();
    expect((await parcel(a.parcel_id)).building_state).toBe("standing");
    expect(await ask(registrar, [a.parcel_id, b.parcel_id], { approve_now: true })).toMatchObject({ count: 2 });
    const after = await asUser(db, surveyor, (tx) => tx.query<{ id: string }>(`select * from public.demolition_candidates(null, null, null, $1, '')`, [neighbourhood]));
    expect(after.rows.map((r) => r.id)).not.toContain(a.parcel_id);
  });
});

describe("what the archive keeps", () => {
  it("the original place, house number, owner, boundary and balance are frozen", async () => {
    const h = await house("06", "Faadumo Archive");
    await ask(registrar, [h.parcel_id], { approve_now: true });
    const s = await scalar<{ pun: string; house_no: string; district: { code: string }; section: { code: string }; sector: { code: string }; neighbourhood: { code: string }; owners: { full_name: string }[]; geom: { type: string }; registered_at: string | null; grade_en: string; balance: number }>(db, `select snapshot from public.demolitions where parcel_id = $1`, [h.parcel_id]);
    expect(s).toMatchObject({ pun: h.pun, house_no: "06", district: { code: "HDN" }, section: { code: "S1" }, sector: { code: "K1" }, neighbourhood: { code: "012" }, grade_en: "Brick" });
    expect(s.owners[0]!.full_name).toBe("Faadumo Archive");
    expect(s.geom.type).toBe("Polygon");
    expect(s.registered_at).toBeTruthy();
  });

  it("bills and balances stay; nothing deleted", async () => {
    const h = await house("07");
    const before = await scalar<string>(db, `select coalesce(sum(total), 0)::text from public.invoices where parcel_id = $1 and status <> 'cancelled'`, [h.parcel_id]);
    await ask(registrar, [h.parcel_id], { approve_now: true });
    expect(await scalar<string>(db, `select coalesce(sum(total), 0)::text from public.invoices where parcel_id = $1 and status <> 'cancelled'`, [h.parcel_id])).toBe(before);
    expect(await scalar<string | null>(db, `select deleted_at from public.parcels where id = $1`, [h.parcel_id])).toBeNull();
  });

  it("each person sees only their districts; those without the right see nothing", async () => {
    expect((await asUser(db, otherRegistrar, (tx) => tx.query(`select * from public.demolitions`))).rows).toHaveLength(0);
    expect((await asUser(db, registrar, (tx) => tx.query(`select * from public.demolitions`))).rows.length).toBeGreaterThan(0);
    expect((await asUser(db, cashier, (tx) => tx.query(`select * from public.demolitions`))).rows).toHaveLength(0);
    await expectError(asUser(db, cashier, (tx) => tx.query(`select public.demolition_stats()`)), "PERMISSION_DENIED");
    const stats = await asUser(db, registrar, (tx) => scalar<{ total: number; this_year: number; by_district: { name: string; count: number }[]; by_neighbourhood: { count: number }[] }>(tx, `select public.demolition_stats()`));
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.this_year).toBe(stats.total);
    expect(stats.by_district[0]!.name).toBe("Hodan");
  });

  it("every step is in the audit log", async () => {
    const h = await house("08");
    await ask(surveyor, [h.parcel_id]);
    const id = await demolitionOf(h.parcel_id);
    await asUser(db, registrar, (tx) => tx.query(`select public.demolition_decide($1, true, null)`, [[id]]));
    const hist = await asUser(db, registrar, (tx) => scalar<{ audit: { action: string }[] }>(tx, `select public.demolition_history($1)`, [id]));
    expect(hist.audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("yearly tax", () => {
  const nextYear = new Date().getUTCFullYear() + 1;
  const candidate = async (id: string) => {
    const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
    const run = await scalar<string>(
      db,
      `insert into public.billing_runs (number, fee_type_id, year, period, district_ids, due_date, issue_date) values ('BR-T-' || gen_random_uuid(), $1, $2, $3, $4, current_date, current_date) returning id`,
      [fee, nextYear, String(nextYear), [district]],
    );
    return db.query<{ amount: string; exception: string | null }>(`select c.amount, c.exception from public.billing_runs r, private.billing_run_candidates(r) c where r.id = $1 and c.parcel_id = $2`, [run, id]);
  };

  it("pays land tax at the Empty Land price instead of the house price, and old balances stay", async () => {
    const h = await house("09");
    expect(Number((await candidate(h.parcel_id)).rows[0]!.amount)).toBe(50);
    await ask(registrar, [h.parcel_id], { approve_now: true });
    expect(Number((await candidate(h.parcel_id)).rows[0]!.amount)).toBe(20);
  });

  it("a demolished building's flats get no more bills; its land does", async () => {
    const f = await units("flats", "10");
    const flat = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [f.parcel_id]);
    expect(Number((await candidate(flat)).rows[0]!.amount)).toBe(12.5);
    expect((await candidate(f.parcel_id)).rows).toHaveLength(0);
    await ask(registrar, [f.parcel_id], { approve_now: true });
    expect((await candidate(flat)).rows).toHaveLength(0);
    expect(Number((await candidate(f.parcel_id)).rows[0]!.amount)).toBe(20);
  });
});

describe("flats and compounds", () => {
  it("one flat can't go alone; the whole building goes and its land keeps the owners", async () => {
    const f = await units("flats", "20");
    const flat = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [f.parcel_id]);
    await expectError(ask(registrar, [flat], { approve_now: true }), "CONFLICT: demolish_whole_building");
    await ask(registrar, [f.parcel_id], { approve_now: true });
    expect(await parcel(f.parcel_id)).toMatchObject({ layout: "house", building_state: "demolished", status: "registered", pun: f.pun });
    expect(await parcel(flat)).toMatchObject({ status: "archived", building_state: "demolished" });
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1 and valid_to is null`, [f.parcel_id])).toBe(2);
    const s = await scalar<{ layout: string; units: { unit_no: string }[] }>(db, `select snapshot from public.demolitions where parcel_id = $1`, [f.parcel_id]);
    expect(s.layout).toBe("flats");
    expect(s.units).toHaveLength(2);
    const names = await scalar<string>(db, `select owner_names from public.demolitions where parcel_id = $1`, [f.parcel_id]);
    expect(names).toContain("Unit One 20");
  });

  it("a flats building waiting for approval shows its flats' owners", async () => {
    const f = await units("flats", "23");
    await ask(surveyor, [f.parcel_id]);
    expect(await scalar<string>(db, `select owner_names from public.demolitions where parcel_id = $1`, [f.parcel_id])).toContain("Unit Two 23");
  });

  it("a compound house can go alone; the others aren't touched", async () => {
    const c = await units("compound", "21");
    const one = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [c.parcel_id]);
    const two = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '02'`, [c.parcel_id]);
    await ask(registrar, [one], { approve_now: true });
    expect((await parcel(one)).building_state).toBe("demolished");
    expect((await parcel(two)).building_state).toBe("standing");
    expect((await parcel(c.parcel_id)).layout).toBe("compound");
  });

  it("the land list says what is demolished, and lists a compound house demolished alone", async () => {
    const c = await units("compound", "24");
    const one = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [c.parcel_id]);
    await ask(registrar, [one], { approve_now: true });
    const f = await units("flats", "25");
    await ask(registrar, [f.parcel_id], { approve_now: true });
    const rows = await asUser(db, registrar, (tx) => tx.query<{ id: string; building_state: string; balance: string }>(`select * from public.search_parcels('', 100)`));
    expect(rows.rows.find((r) => r.id === one)?.building_state).toBe("demolished");
    expect(rows.rows.find((r) => r.id === f.parcel_id)?.building_state).toBe("demolished");
    expect(rows.rows.find((r) => r.id === c.parcel_id)?.building_state).toBe("standing");
    // The flats themselves are archived, not listed again.
    const flats = await scalar<string[]>(db, `select array_agg(id) from public.parcels where parent_id = $1`, [f.parcel_id]);
    expect(rows.rows.some((r) => flats.includes(r.id))).toBe(false);
  });

  it("undoing a mistake puts the building back", async () => {
    const f = await units("flats", "22");
    await ask(registrar, [f.parcel_id], { approve_now: true });
    const id = await demolitionOf(f.parcel_id);
    await expectError(asUser(db, registrar, (tx) => tx.query(`select public.demolition_restore($1, 'no')`, [id])), "VALIDATION: reason");
    await asUser(db, registrar, (tx) => tx.query(`select public.demolition_restore($1, 'Marked by mistake')`, [id]));
    expect(await parcel(f.parcel_id)).toMatchObject({ layout: "flats", building_state: "standing", property_type: "brick" });
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where parent_id = $1 and status = 'registered' and building_state = 'standing'`, [f.parcel_id])).toBe(2);
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1`, [f.parcel_id])).toBe(0);
    expect(await scalar<string>(db, `select status from public.demolitions where id = $1`, [id])).toBe("restored");
  });
});

describe("registering again", () => {
  const again = (id: string, p: Record<string, unknown>, user = registrar) => asUser(db, user, (tx) => scalar<{ building_no: string; pun: string }>(tx, `select public.demolition_reregister($1, $2)`, [id, JSON.stringify(p)]));

  it("to a new owner: same PUN, new building number and house number; the old record stays", async () => {
    const h = await house("30", "Old Owner Thirty");
    await ask(registrar, [h.parcel_id], { approve_now: true });
    const id = await demolitionOf(h.parcel_id);
    await expectError(again(id, { keep_owner: true, property_type: "brick" }, surveyor), "PERMISSION_DENIED");
    await expectError(again(id, { keep_owner: false, property_type: "brick" }), "VALIDATION: owner_name");
    await expectError(again(id, { keep_owner: true, property_type: "nope" }), "VALIDATION: property_type");
    const r = await again(id, { keep_owner: false, owner_name: "New Owner Thirty", property_type: "brick", house_no: "31" });
    expect(r.pun).toBe(h.pun);
    expect(r.building_no).toMatch(/^BLD-\d{4}-\d{6}$/);
    expect(await parcel(h.parcel_id)).toMatchObject({ pun: h.pun, house_no: "31", building_state: "standing", property_type: "brick", building_no: r.building_no });
    const owners = await db.query<{ full_name: string }>(`select pa.full_name from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = $1 and po.valid_to is null`, [h.parcel_id]);
    expect(owners.rows.map((o) => o.full_name)).toEqual(["New Owner Thirty"]);
    const d = await scalar<{ status: string; house_no: string; owner_names: string; building_no: string; new_house_no: string; snapshot: { house_no: string; owners: { full_name: string }[] } }>(db, `select row_to_json(d) from public.demolitions d where id = $1`, [id]);
    expect(d).toMatchObject({ status: "approved", house_no: "30", owner_names: "Old Owner Thirty", building_no: r.building_no, new_house_no: "31" });
    expect(d.snapshot.owners[0]!.full_name).toBe("Old Owner Thirty");
    await expectError(again(id, { keep_owner: true, property_type: "brick" }), "CONFLICT: demolish_cannot_rebuild");
  });

  it("to the same owner; the land can be demolished again later and both records stay", async () => {
    const h = await house("32", "Same Owner");
    await ask(registrar, [h.parcel_id], { approve_now: true });
    const first = await demolitionOf(h.parcel_id);
    await again(first, { keep_owner: true, property_type: "brick" });
    await expect(asUser(db, registrar, (tx) => tx.query(`select public.demolition_restore($1, 'Marked by mistake')`, [first]))).rejects.toThrow(/demolish_cannot_restore/);
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1 and valid_to is null`, [h.parcel_id])).toBe(1);
    await ask(registrar, [h.parcel_id], { approve_now: true });
    expect(await scalar<number>(db, `select count(*)::int from public.demolitions where parcel_id = $1`, [h.parcel_id])).toBe(2);
  });

  it("a new house number can't be one already taken", async () => {
    const a = await house("33");
    await house("34");
    await ask(registrar, [a.parcel_id], { approve_now: true });
    await expectError(again(await demolitionOf(a.parcel_id), { keep_owner: true, property_type: "brick", house_no: "34" }), "CONFLICT: house_no_taken");
  });
});
