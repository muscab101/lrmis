import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let surveyor: string;
let hodan: string;
let nbhd: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','S','S') returning id`, [hodan]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K1','K','K') returning id`, [section]);
  nbhd = await scalar<string>(
    db,
    `insert into public.neighbourhoods (sector_id, code, name_so, name_en, geom)
     values ($1,'012','Taleex','Taleh', extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson($2), 4326))) returning id`,
    [sector, JSON.stringify(square(45.3, 2.04, 0.004))],
  );
  admin = await bootstrapSuperAdmin(db);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
});

describe("property types (admin list)", () => {
  it("starts with the ten types; everyone can read them", async () => {
    const n = await asUser(db, surveyor, (tx) => scalar<number>(tx, `select count(*)::int from public.property_types`));
    expect(n).toBe(10);
  });

  it("only admins add and edit; the code comes from the English name", async () => {
    const p = JSON.stringify({ name_so: "Guri laba dabaq", name_en: "Two-storey house", price: 1500 });
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.property_type_save(null, $1)`, [p])), "PERMISSION_DENIED");
    const id = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_save(null, $1)`, [p]));
    const t = await scalar<{ code: string; price: string }>(db, `select to_jsonb(t) from public.property_types t where id = $1`, [id]);
    expect(t.code).toBe("two_storey_house");
    expect(Number(t.price)).toBe(1500);
    await asUser(db, admin, (tx) => tx.query(`select public.property_type_save($1, $2)`, [id, JSON.stringify({ name_so: "Guri laba dabaq", name_en: "Two-storey house", price: 1800 })]));
    expect(Number(await scalar<string>(db, `select price from public.property_types where id = $1`, [id]))).toBe(1800);
  });

  it("staff pick an admin type for new land; a hidden type can't be picked", async () => {
    const app = await asUser(db, surveyor, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd })]));
    await asUser(db, surveyor, (tx) => tx.query(`select public.application_set_details($1, '', '', 'two_storey_house', 'residential')`, [app.id]));
    expect(await scalar<string>(db, `select property_type from public.applications where id = $1`, [app.id])).toBe("two_storey_house");
    // In use → hidden, not deleted.
    const id = await scalar<string>(db, `select id from public.property_types where code = 'two_storey_house'`);
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_delete($1)`, [id]))).toBe("hidden");
    const app2 = await asUser(db, surveyor, (tx) => scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd })]));
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.application_set_details($1, '', '', 'two_storey_house', null)`, [app2.id])), "VALIDATION: property_type_inactive");
    // An unused type is really deleted.
    const unused = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_save(null, '{"name_so":"Tijaabo","name_en":"Trial type"}')`));
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_delete($1)`, [unused]))).toBe("deleted");
  });
});

describe("two invoices on submit: property bill and registration fee (0052)", () => {
  async function submitWithType(code: string | null, lon: number, size: [number, number] | null = [12, 12]) {
    return asUser(db, surveyor, async (tx) => {
      const owner = await scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: `Owner ${lon}`, phone: `+2526122${String(lon).slice(-5).replace(".", "")}`, district_id: hodan })]);
      const a = await scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: lon, pin_lat: 2.04 })]);
      if (size) await tx.query(`select public.application_location_meta($1, null, $2, $3)`, [a.id, size[0], size[1]]);
      await tx.query(`select public.application_set_details($1, '', '', $2, null)`, [a.id, code]);
      await tx.query(`select public.application_set_parties($1, $2)`, [a.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]);
      await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/id.pdf`]);
      await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'd.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/d.pdf`]);
      await tx.query(`select public.application_submit($1)`, [a.id]);
      return a.id;
    });
  }
  const invoicesOf = (app: string) =>
    db
      .query<{ fee: string; total: string; line: string }>(
        `select f.code as fee, i.total::text, (select l.description from public.invoice_lines l where l.invoice_id = i.id limit 1) as line
           from public.invoices i join public.fee_types f on f.id = i.fee_type_id join public.parcels p on p.id = i.parcel_id
          where p.application_id = $1 order by f.code`,
        [app],
      )
      .then((r) => r.rows);

  it("bills width × length × the type's price per m², plus the $12 registration fee", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.property_type_save((select id from public.property_types where code = 'villa'), '{"name_so":"Fiilo","name_en":"Villa","price":0.3}')`));
    const inv = await invoicesOf(await submitWithType("villa", 45.2981));
    expect(inv.map((i) => [i.fee, Number(i.total)])).toEqual([
      ["property_bill", 43.2],
      ["registration_fee", 12],
    ]);
    expect(inv[0]!.line).toBe("Villa: 12 m × 12 m = 144 m² × 0.30 USD per m²");
  });

  it("no type or a zero price: only the registration fee", async () => {
    expect((await invoicesOf(await submitWithType("hut", 45.2983))).map((i) => i.fee)).toEqual(["registration_fee"]);
    expect((await invoicesOf(await submitWithType(null, 45.2984))).map((i) => i.fee)).toEqual(["registration_fee"]);
  });

  it("a priced type needs the plot size before submitting", async () => {
    await expectError(submitWithType("villa", 45.2985, null), "VALIDATION: plot_size_required");
  });

  it("admins change the registration fee; paying both invoices moves the application to survey", async () => {
    await db.query(`update public.fee_types set amount = 15 where code = 'registration_fee'`);
    const app = await submitWithType("villa", 45.2986);
    const inv = await invoicesOf(app);
    expect(inv.map((i) => Number(i.total))).toEqual([43.2, 15]);
    const ids = (await db.query<{ id: string }>(`select i.id from public.invoices i join public.parcels p on p.id = i.parcel_id where p.application_id = $1 order by i.total`, [app])).rows;
    await db.query(`update public.invoices set status = 'paid' where id = $1`, [ids[0]!.id]);
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("awaiting_payment");
    await db.query(`update public.invoices set status = 'paid' where id = $1`, [ids[1]!.id]);
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("in_survey");
    await db.query(`update public.fee_types set amount = 12 where code = 'registration_fee'`);
  });
});

describe("a price in SOS needs an exchange rate (0048)", () => {
  it("is refused until a rate exists", async () => {
    const p = JSON.stringify({ name_so: "Guri SOS", name_en: "SOS priced", price: 500000, currency: "SOS" });
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.property_type_save(null, $1)`, [p])), "VALIDATION: fx_rate_missing");
    await db.query(`insert into public.fx_rates (currency, rate, rate_date) values ('SOS', 571, current_date)`);
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.property_type_save(null, $1)`, [p]))).toBeTruthy();
  });
});

describe("Admin → Fees (0053)", () => {
  it("only admins set a fee amount; the property bill comes from the types", async () => {
    const reg = await scalar<string>(db, `select id from public.fee_types where code = 'registration_fee'`);
    await expectError(asUser(db, surveyor, (tx) => tx.query(`select public.fee_set_amount($1, 20, true)`, [reg])), "PERMISSION_DENIED");
    await asUser(db, admin, (tx) => tx.query(`select public.fee_set_amount($1, 20, true)`, [reg]));
    expect(Number(await scalar<string>(db, `select amount::text from public.fee_types where id = $1`, [reg]))).toBe(20);
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.fee_set_amount($1, -1, true)`, [reg])), "VALIDATION");
    const bill = await scalar<string>(db, `select id from public.fee_types where code = 'property_bill'`);
    await expectError(asUser(db, admin, (tx) => tx.query(`select public.fee_set_amount($1, 5, true)`, [bill])), "VALIDATION: property_bill_from_types");
    await asUser(db, admin, (tx) => tx.query(`select public.fee_set_amount($1, 12, true)`, [reg]));
  });
});
