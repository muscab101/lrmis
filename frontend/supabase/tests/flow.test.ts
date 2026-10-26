import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

// The flow as drawn (0061): survey → owner + land → two invoices → review (? / correct + re-bill / ✓)
// → registered → the district's cashiers are told → payment → certificate by the system.

let db: PGlite;
let admin: string;
let surveyor: string;
let cashier: string;
let otherCashier: string;
let hodan: string;
let nbhd: string;
let shift: string;
let app: string;

const fees = () =>
  db
    .query<{ code: string; id: string; total: string; status: string; lines: number }>(
      `select f.code, i.id, i.total::text, i.status::text, (select count(*)::int from public.invoice_lines l where l.invoice_id = i.id) as lines
         from public.invoices i join public.fee_types f on f.id = i.fee_type_id join public.parcels p on p.id = i.parcel_id
        where p.application_id = $1 and i.status <> 'cancelled' order by f.code`,
      [app],
    )
    .then((r) => r.rows);

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  const wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
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
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  otherCashier = await createStaff(db, admin, "cashier.wdj@gmail.com", ["cashier"], [wadajir]);
  await db.query(`update public.property_grades set amount = 0.3 where code = 'villa'`);
  await db.query(`update public.fee_types set amount = 12, active = true where code = 'service_charge'`);
  const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1', 'Hodan office', $1, 'HDN1') returning id`, [hodan]);
  shift = await asUser(db, cashier, (tx) => scalar<string>(tx, `select public.shift_open($1, 0)`, [pos]));
});

describe("the flow as drawn (0061)", () => {
  it("the survey creates owner + land; submitting raises the tax bill and the service charge and goes straight to review", async () => {
    app = await asUser(db, surveyor, async (tx) => {
      const owner = await scalar<string>(tx, `select public.save_party(null, $1)`, [JSON.stringify({ full_name: "Flow Owner", phone: "+252612220001", district_id: hodan })]);
      const a = await scalar<{ id: string }>(tx, `select public.application_create($1)`, [JSON.stringify({ district_id: hodan, neighbourhood_id: nbhd, pin_lon: 45.3, pin_lat: 2.04 })]);
      await tx.query(`select public.application_location_meta($1, null, 12, 12)`, [a.id]);
      await tx.query(`select public.application_set_details($1, '01', '', 'villa', 'residential')`, [a.id]);
      await tx.query(`select public.application_set_parties($1, $2)`, [a.id, JSON.stringify([{ party_id: owner, role: "owner", share_pct: 100 }])]);
      await tx.query(`select public.application_add_document($1, 'identity', $2, 'id.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/id.pdf`]);
      await tx.query(`select public.application_add_document($1, 'old_deed', $2, 'd.pdf', 'application/pdf', 10)`, [a.id, `${a.id}/d.pdf`]);
      await tx.query(`select public.application_submit($1)`, [a.id]);
      return a.id;
    });
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("in_survey");
    expect((await fees()).map((f) => [f.code, Number(f.total)])).toEqual([
      ["property_bill", 43.2],
      ["service_charge", 12],
    ]);
    expect(await scalar<string>(db, `select name_en from public.fee_types where code = 'property_bill'`)).toBe("Tax bill");
    // The service charge is SV- with the tax bill's number, and no INV number is skipped.
    const nums = await db.query<{ code: string; number: string }>(
      `select f.code, i.number from public.invoices i join public.fee_types f on f.id = i.fee_type_id
        where i.parcel_id = (select parcel_id from public.applications where id = $1) order by f.code`,
      [app],
    );
    const tax = nums.rows.find((r) => r.code === "property_bill")!.number;
    expect(tax).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(nums.rows.find((r) => r.code === "service_charge")!.number).toBe(`SV-${tax.slice(4)}`);
    const last = await scalar<number>(db, `select last_serial from public.serial_counters where scope = $1`, [`INV-${tax.slice(4, 8)}`]);
    expect(last).toBe(Number(tax.slice(-6)));
  });

  it("staff correct the size and type; Re-bill updates the same invoice", async () => {
    const before = await fees();
    await asUser(db, admin, (tx) => tx.query(`select public.application_correct_land($1, 12, 15, 'villa', 'Measured on site')`, [app]));
    const fee = await asUser(db, admin, (tx) => scalar<{ needs_rebill: boolean }>(tx, `select public.application_fee($1)`, [app]));
    expect(fee.needs_rebill).toBe(true);
    await asUser(db, admin, (tx) => tx.query(`select public.application_rebill($1)`, [app]));
    const after = await fees();
    expect(after.find((f) => f.code === "property_bill")!.id).toBe(before.find((f) => f.code === "property_bill")!.id);
    expect(Number(after.find((f) => f.code === "property_bill")!.total)).toBe(54); // 12 × 15 × 0.30
    expect(after.find((f) => f.code === "property_bill")!.lines).toBe(2); // original + re-bill line
    expect((await asUser(db, admin, (tx) => scalar<{ needs_rebill: boolean }>(tx, `select public.application_fee($1)`, [app]))).needs_rebill).toBe(false);
  });

  it("✓ and Move to Parcels registers before payment; only that district's cashiers are told", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.application_request_site_check($1, $2)`, [app, surveyor]));
    await asUser(db, surveyor, (tx) => tx.query(`select public.application_confirm_site($1, true)`, [app]));
    await asUser(db, admin, (tx) => tx.query(`select public.application_register_confirmed($1)`, [app]));
    expect(await scalar<string>(db, `select status::text from public.applications where id = $1`, [app])).toBe("approved");
    const told = (who: string) => scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'cashier.parcel_registered'`, [who]);
    expect(await told(cashier)).toBe(1);
    expect(await told(otherCashier)).toBe(0);
    // Not paid yet: no certificate.
    const parcel = await scalar<string>(db, `select parcel_id from public.applications where id = $1`, [app]);
    expect(await scalar<number>(db, `select count(*)::int from public.issued_documents where parcel_id = $1 and type = 'certificate'`, [parcel])).toBe(0);
  });

  it("the cashier takes the payments; when all is paid the system creates the certificate", async () => {
    const parcel = await scalar<string>(db, `select parcel_id from public.applications where id = $1`, [app]);
    for (const f of await fees()) {
      await asUser(db, cashier, (tx) =>
        tx.query(`select public.cashier_take_payment($1, $2)`, [shift, JSON.stringify({ parcel_id: parcel, invoice_id: f.id, amount: Number(f.total), method: "cash" })]),
      );
    }
    expect(await scalar<string>(db, `select fee_status::text from public.applications where id = $1`, [app])).toBe("paid");
    expect(await scalar<number>(db, `select count(*)::int from public.issued_documents where parcel_id = $1 and type = 'certificate' and status = 'valid'`, [parcel])).toBe(1);
  });
});
