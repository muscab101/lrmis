import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let surveyor: string;
let district: string;
let neighbourhood: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}
const base = () => ({ district_id: district, neighbourhood_id: neighbourhood, pin_lon: 45.3, pin_lat: 2.04, plot_width_m: 25, plot_length_m: 40, property_type: "", land_use: "residential" });
const create = (p: Record<string, unknown>) => asUser(db, surveyor, (tx) => scalar<{ parcel_id: string; pun: string; bills: number }>(tx, `select public.land_with_units_create($1)`, [JSON.stringify({ ...base(), ...p })]));
const houses = [
  { unit_no: "a", own_m2: 200, owner_name: "Amina Compound" },
  { unit_no: "b", own_m2: 150, owner_name: "Bashir Compound" },
];
const spaces = [{ name: "Play place", area_m2: 100 }];
type Unit = { pun: string; unit_no: string; own_m2: string; shared_m2: string; area_m2: string; status: string };
const unitsOf = async (parent: string) => (await db.query<Unit>(`select pun, unit_no, own_m2, shared_m2, area_m2, status from public.parcels where parent_id = $1 order by unit_no`, [parent])).rows;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  neighbourhood = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04))],
  );
  admin = await bootstrapSuperAdmin(db);
  // These tests price flats by the building's own type: the Apartment / Upper Floors prices (0241) are switched off.
  await db.query(`update public.property_grades set active = false where code in ('apartment', 'upper')`);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [district]);
});

describe("shared compound", () => {
  it("splits the shared m² equally; the rest of the land is empty land", async () => {
    const r = await create({ layout: "compound", shared_split: "equal", units: houses, shared_spaces: spaces, house_no: "01" });
    const units = await unitsOf(r.parcel_id);
    expect(units.map((u) => [u.pun, Number(u.own_m2), Number(u.shared_m2), Number(u.area_m2)])).toEqual([
      [`${r.pun}-A`, 200, 325, 525],
      [`${r.pun}-B`, 150, 325, 475],
    ]);
    const shared = await db.query<{ name: string; area_m2: string }>(`select name, area_m2 from public.parcel_shared_spaces where parcel_id = $1 order by name`, [r.parcel_id]);
    expect(shared.rows.map((s) => [s.name, Number(s.area_m2)])).toEqual([["Empty land", 550], ["Play place", 100]]);
  });

  it("or by house size, and the totals always add up to the land", async () => {
    const r = await create({ layout: "compound", shared_split: "by_size", units: houses, shared_spaces: spaces, house_no: "02" });
    const units = await unitsOf(r.parcel_id);
    expect(units.map((u) => Number(u.area_m2))).toEqual([571.43, 428.57]);
    expect(units.reduce((s, u) => s + Number(u.area_m2), 0)).toBeCloseTo(1000, 2);
  });

  it("refuses houses and spaces bigger than the land", async () => {
    await expectError(create({ layout: "compound", units: [{ unit_no: "A", own_m2: 900, owner_name: "Amina" }, { unit_no: "B", own_m2: 200, owner_name: "Bashir" }] }), "VALIDATION: compound_too_big");
    await expectError(create({ layout: "compound", units: houses, shared_spaces: [{ name: "Play", area_m2: 700 }] }), "VALIDATION: compound_too_big");
  });
});

describe("flats building", () => {
  const flats = [
    { unit_no: "01", floor: 0, own_m2: 80, owner_name: "Cali Flat" },
    { unit_no: "02", floor: 1, own_m2: 90, owner_name: "Hodan Flat" },
    { unit_no: "03", floor: 1, own_m2: 90, owner_name: "Cali Flat" },
  ];
  let land: { parcel_id: string; pun: string };

  it("checks floors and numbers, and keeps each flat's own m²", async () => {
    await expectError(create({ layout: "flats", floors: 2, units: [flats[0]] }), "VALIDATION: units_few");
    await expectError(create({ layout: "flats", units: flats }), "VALIDATION: unit_floors");
    await expectError(create({ layout: "flats", floors: 1, units: [flats[0], { ...flats[1], floor: 3 }] }), "VALIDATION: unit_floor");
    await expectError(create({ layout: "flats", floors: 2, units: [flats[0], { ...flats[1], unit_no: "01" }] }), "VALIDATION: unit_no_twice");
    land = await create({ layout: "flats", floors: 2, units: flats, house_no: "03" });
    const units = await unitsOf(land.parcel_id);
    expect(units.map((u) => [u.pun, Number(u.area_m2), Number(u.shared_m2)])).toEqual([
      [`${land.pun}-01`, 80, 0],
      [`${land.pun}-02`, 90, 0],
      [`${land.pun}-03`, 90, 0],
    ]);
  });

  it("the same person with two flats is one owner; the land itself has no owner", async () => {
    const owners = await scalar<number>(db, `select count(distinct po.party_id)::int from public.parcel_owners po join public.parcels p on p.id = po.parcel_id where p.parent_id = $1`, [land.parcel_id]);
    expect(owners).toBe(2);
    expect(await scalar<number>(db, `select count(*)::int from public.parcel_owners where parcel_id = $1`, [land.parcel_id])).toBe(0);
  });

  it("the list shows each flat with its own owner, not the building, in Partial and Registered", async () => {
    const all = await asUser(db, admin, (tx) => tx.query<{ pun: string; owners: string; status: string }>(`select * from public.search_parcels('', 100)`));
    const mine = all.rows.filter((r) => r.pun?.startsWith(land.pun)).sort((a, b) => a.pun.localeCompare(b.pun));
    expect(mine.map((r) => [r.pun, r.owners, r.status])).toEqual([
      [`${land.pun}-01`, "Cali Flat", "draft"],
      [`${land.pun}-02`, "Hodan Flat", "draft"],
      [`${land.pun}-03`, "Cali Flat", "draft"],
    ]);
  });

  it("a flat registers alone and the building follows; a registered flat can't be deleted alone; the rest register all at once", async () => {
    const unit = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [land.parcel_id]);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [unit]));
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'not needed any more')`, [unit])), "CONFLICT: unit_follows_land");
    expect((await unitsOf(land.parcel_id)).map((u) => u.status)).toEqual(["registered", "draft", "draft"]);
    expect(await scalar<string>(db, `select status from public.parcels where id = $1`, [land.parcel_id])).toBe("registered");
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [unit])), "CONFLICT: status");
    for (const u of await scalar<string[]>(db, `select array_agg(id) from public.parcels where parent_id = $1 and status = 'draft'`, [land.parcel_id])) {
      await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [u]));
    }
    const other = await create({ layout: "flats", floors: 2, units: flats, house_no: "99" });
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [other.parcel_id]));
    expect((await unitsOf(other.parcel_id)).map((u) => u.status)).toEqual(["registered", "registered", "registered"]);
    expect((await unitsOf(land.parcel_id)).map((u) => u.status)).toEqual(["registered", "registered", "registered"]);
    expect(await scalar<string>(db, `select status from public.parcels where id = $1`, [land.parcel_id])).toBe("registered");
  });

  it("each unit can have a certificate, the land above can't; subdivide refuses both", async () => {
    expect(await scalar<string[]>(db, `select private.certificate_blockers($1)`, [land.parcel_id])).toEqual(["has_units"]);
    const unit = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = '01'`, [land.parcel_id]);
    expect(await scalar<string[]>(db, `select private.certificate_blockers($1)`, [unit])).not.toContain("has_units");
    await expect(db.query(`update public.parcels set area_m2 = 5 where id = $1`, [unit])).rejects.toThrow(/CONFLICT: units_fixed/);
  });

  it("searching finds one flat by its PUN", async () => {
    const found = await asUser(db, admin, (tx) => tx.query<{ pun: string }>(`select * from public.search_parcels($1, 100)`, [`${land.pun}-02`]));
    expect(found.rows.map((r) => r.pun)).toEqual([`${land.pun}-02`]);
  });

  it("deleting the land takes its units", async () => {
    const r = await create({ layout: "flats", floors: 2, units: flats, house_no: "04" });
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'entered by mistake')`, [r.parcel_id]));
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where parent_id = $1 and deleted_at is null`, [r.parcel_id])).toBe(0);
  });
});

describe("each unit's bills", () => {
  it("a unit is priced on its total m², the land above has no bills, and yearly bills skip the land", async () => {
    await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('unit_test','Darajo','Grade', 0.5) on conflict (code) do update set amount = 0.5`);
    const r = await create({ layout: "compound", shared_split: "equal", units: houses, shared_spaces: spaces, property_type: "unit_test", house_no: "09" });
    const bills = await db.query<{ pun: string; total: string }>(
      `select p.pun, i.total from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id join public.parcels p on p.id = i.parcel_id
        where p.parent_id = $1 and ft.code = 'property_bill' order by p.pun`, [r.parcel_id]);
    expect(bills.rows.map((b) => Number(b.total))).toEqual([262.5, 237.5]);
    expect(await scalar<number>(db, `select count(*)::int from public.invoices where parcel_id = $1`, [r.parcel_id])).toBe(0);
    expect(await scalar<number>(db, `select private.parcel_bill($1)`, [r.parcel_id])).toBe(0);
  });

  it("money can't be recorded on a compound's land itself, only on a house", async () => {
    const r = await create({ layout: "compound", shared_split: "equal", units: [{ unit_no: "a", own_m2: 80, owner_name: "Pay Test One" }, { unit_no: "b", own_m2: 80, owner_name: "Pay Test Two" }], shared_spaces: [], house_no: "11" });
    await expect(
      asUser(db, admin, (tx) => tx.query(`select public.payment_record_manual($1)`, [JSON.stringify({ parcel_id: r.parcel_id, amount: 10, currency: "USD", method: "bank_transfer", reference: "UNITTEST", provider_ref: "BANK-UNITTEST", received_at: "2026-11-03T12:00:00Z" })])),
    ).rejects.toThrow(/land_has_units/);
  });
});

describe("changing land not registered yet", () => {
  const taxBill = (parcel: string) =>
    db
      .query<{ id: string; total: string; status: string }>(
        `select i.id, i.total, i.status from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id where i.parcel_id = $1 and ft.code = 'property_bill' and i.status <> 'cancelled'`,
        [parcel],
      )
      .then((r) => r.rows[0]);
  const edit = (id: string, p: Record<string, unknown>) => asUser(db, admin, (tx) => tx.query(`select public.parcel_update_details($1, $2)`, [id, JSON.stringify(p)]));
  /** Saving leaves the bill; the Re-bill button makes it follow the new size or type. */
  const rebill = (id: string) => asUser(db, admin, (tx) => tx.query(`select public.parcel_rebill_now($1)`, [id]));
  const remove = (id: string) => asUser(db, admin, (tx) => tx.query(`select public.parcel_delete($1, 'saved by mistake')`, [id]));
  const unitId = (land: string, no: string) => scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = $2`, [land, no]);
  const flats = [
    { unit_no: "A", floor: 0, own_m2: 80, owner_name: "Rebill One" },
    { unit_no: "B", floor: 1, own_m2: 90, owner_name: "Rebill Two" },
  ];

  beforeAll(async () => {
    await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('unit_test','Darajo','Grade', 0.5), ('unit_dear','Qaali','Dear', 1) on conflict (code) do update set amount = excluded.amount`);
  });

  it("after a flat's new size or type, Re-bill changes the same bill, and the books; its neighbour's bill stays", async () => {
    const r = await create({ layout: "flats", floors: 1, units: flats, property_type: "unit_test", house_no: "71" });
    const a = await unitId(r.parcel_id, "A");
    const b = await unitId(r.parcel_id, "B");
    const before = (await taxBill(a))!;
    expect(Number(before.total)).toBe(40);
    // A flat's new size re-bills the building by itself (0241): nothing is left for Re-bill to do.
    await edit(a, { own_m2: "100", unit_floor: "1" });
    expect(Number((await taxBill(a))!.total)).toBe(50);
    const check = await asUser(db, admin, (tx) => scalar<{ differs: boolean; expected: { amount: number } }>(tx, `select public.parcel_bill_check($1)`, [a]));
    expect(check.differs).toBe(false);
    const after = (await taxBill(a))!;
    expect(after.id).toBe(before.id);
    expect(Number(after.total)).toBe(50);
    expect(await scalar<number>(db, `select sum(amount)::float from public.invoice_lines where invoice_id = $1`, [after.id])).toBe(50);
    expect(await scalar<string>(db, `select description from public.invoice_lines where invoice_id = $1 order by created_at desc limit 1`, [after.id])).toMatch(/^Re-bill: .*was 40/);
    expect(await scalar<number>(db, `select sum(l.debit - l.credit)::float from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.source_id = $1 and l.account = '1200'`, [after.id])).toBe(50);
    expect(Number((await taxBill(b))!.total)).toBe(45);
    await edit(a, { property_type: "unit_dear" });
    await rebill(a);
    expect(Number((await taxBill(a))!.total)).toBe(100);
    // A new price on the grade waits for a change that needs a new bill: a new house number isn't one.
    await db.query(`update public.property_grades set amount = 2 where code = 'unit_dear'`);
    await edit(a, { house_no: "71-X" });
    expect(Number((await taxBill(a))!.total)).toBe(100);
    await db.query(`update public.property_grades set amount = 1 where code = 'unit_dear'`);
    await expectError(edit(a, { own_m2: "0" }), "VALIDATION: unit_size");
    await expectError(edit(a, { unit_floor: "9" }), "VALIDATION: unit_floor");
  });

  it("a registered flat's size is fixed and its bill stays", async () => {
    const r = await create({ layout: "flats", floors: 1, units: flats, property_type: "unit_test", house_no: "72" });
    const a = await unitId(r.parcel_id, "A");
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [a]));
    await expectError(edit(a, { own_m2: "100" }), "CONFLICT: units_fixed");
    expect(Number((await taxBill(a))!.total)).toBe(40);
  });

  it("a normal house not registered yet is re-billed (with Re-bill) after its size changes", async () => {
    const r = await asUser(db, surveyor, (tx) =>
      scalar<{ parcel_id: string }>(tx, `select public.land_with_units_create($1)`, [JSON.stringify({ ...base(), layout: "flats", floors: 1, units: flats, property_type: "unit_test", house_no: "73" })]),
    );
    const house = await scalar<string>(
      db,
      `insert into public.parcels (district_id, neighbourhood_id, house_no, property_type, area_m2, plot_width_m, plot_length_m, geom, status)
       select district_id, neighbourhood_id, '74', 'unit_test', 100, 10, 10, geom, 'draft' from public.parcels where id = $1 returning id`,
      [r.parcel_id],
    );
    await db.query(`select private.parcel_bill($1)`, [house]);
    expect(Number((await taxBill(house))!.total)).toBe(50);
    await edit(house, { plot_width_m: "20", plot_length_m: "10" });
    expect(Number((await taxBill(house))!.total)).toBe(50);
    await rebill(house);
    expect(Number((await taxBill(house))!.total)).toBe(100);
  });

  it("changing a compound house shares the land out again, re-bills them all, and can't go over the land", async () => {
    const r = await create({ layout: "compound", shared_split: "by_size", units: houses, shared_spaces: spaces, property_type: "unit_test", house_no: "75" });
    const [one, two] = await unitsOf(r.parcel_id);
    const first = await unitId(r.parcel_id, one!.unit_no);
    const second = await unitId(r.parcel_id, two!.unit_no);
    const land = Number(one!.area_m2) + Number(two!.area_m2);
    await edit(first, { own_m2: String(Number(one!.own_m2) + 50) });
    const [a, b] = await unitsOf(r.parcel_id);
    expect(Number(a!.own_m2)).toBe(Number(one!.own_m2) + 50);
    expect(Number(a!.area_m2) + Number(b!.area_m2)).toBeCloseTo(land, 2);
    expect(Number((await taxBill(first))!.total)).toBeCloseTo(Number(a!.area_m2) * 0.5, 2);
    expect(Number((await taxBill(second))!.total)).toBeCloseTo(Number(b!.area_m2) * 0.5, 2);
    await expectError(edit(first, { own_m2: "99999" }), "VALIDATION: compound_too_big");
  });

  it("one flat or house not registered can be deleted alone, its bills cancelled; the last one takes the land", async () => {
    const r = await create({ layout: "flats", floors: 1, units: flats, property_type: "unit_test", house_no: "76" });
    const a = await unitId(r.parcel_id, "A");
    const b = await unitId(r.parcel_id, "B");
    await remove(a);
    expect(await taxBill(a)).toBeUndefined();
    expect((await unitsOf(r.parcel_id)).filter((u) => u.status === "draft").length).toBeGreaterThan(0);
    expect(await scalar<number>(db, `select units from public.parcels where id = $1`, [r.parcel_id])).toBe(1);
    expect(await scalar<string | null>(db, `select deleted_at::text from public.parcels where id = $1`, [r.parcel_id])).toBeNull();
    await remove(b);
    expect(await scalar<string | null>(db, `select deleted_at::text from public.parcels where id = $1`, [r.parcel_id])).not.toBeNull();
  });

  it("once a compound house is registered, the others can't change size or be deleted", async () => {
    const r = await create({ layout: "compound", shared_split: "equal", units: houses, shared_spaces: spaces, property_type: "unit_test", house_no: "77" });
    const [one, two] = await unitsOf(r.parcel_id);
    const first = await unitId(r.parcel_id, one!.unit_no);
    const second = await unitId(r.parcel_id, two!.unit_no);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [first]));
    await expectError(edit(second, { own_m2: String(Number(two!.own_m2) + 1) }), "CONFLICT: compound_started");
    await expectError(remove(second), "CONFLICT: compound_started");
  });
});

describe("a registered flat", () => {
  it("can change its house number, not its type or size", async () => {
    await db.query(`insert into public.property_grades (code, name_so, name_en, amount) values ('unit_test','Darajo','Grade', 0.5), ('unit_dear','Qaali','Dear', 1) on conflict (code) do update set amount = excluded.amount`);
    const flats = [
      { unit_no: "A", floor: 0, own_m2: 80, owner_name: "Office One" },
      { unit_no: "B", floor: 1, own_m2: 90, owner_name: "Office Two" },
    ];
    const r = await create({ layout: "flats", floors: 1, units: flats, property_type: "unit_test", house_no: "81" });
    const a = await scalar<string>(db, `select id from public.parcels where parent_id = $1 and unit_no = 'A'`, [r.parcel_id]);
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_register($1)`, [a]));
    const edit = (p: Record<string, unknown>) => asUser(db, admin, (tx) => tx.query(`select public.parcel_update_details($1, $2)`, [a, JSON.stringify(p)]));
    await edit({ house_no: "81-A1", plot_no: "P-7" });
    expect(await scalar<string>(db, `select house_no from public.parcels where id = $1`, [a])).toBe("81-A1");
    await expectError(edit({ property_type: "unit_dear" }), "CONFLICT: registered_size_fixed");
    await expectError(edit({ own_m2: "100" }), "CONFLICT: units_fixed");
  });
});
