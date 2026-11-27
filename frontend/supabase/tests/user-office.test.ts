import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

// The office each user works for, from what is already assigned to them (0293).
let db: PGlite;
let admin: string;
let hodan: string;
let karaan: string;
let sector: string;

const office = (as: string, of: string | null = null) =>
  asUser(db, as, (tx) => scalar<Record<string, unknown>>(tx, `select public.user_office($1)`, [of]));

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  karaan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'KRN','Karaan','Karaan') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','Qaybta 1','Section 1') returning id`, [hodan]);
  sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'K7','Laanta 7','Sector 7') returning id`, [section]);
  admin = await bootstrapSuperAdmin(db);
});

describe("user office (0293)", () => {
  it("a super admin with no office is head office", async () => {
    expect(await office(admin)).toMatchObject({ level: "head_office" });
  });

  it("one district, several districts, a cash desk, a sector", async () => {
    const one = await createStaff(db, admin, "one@gmail.com", ["customer_service"], [hodan]);
    expect(await office(one)).toMatchObject({ level: "district", name_en: "Hodan" });

    const two = await createStaff(db, admin, "two@gmail.com", ["customer_service"], [hodan, karaan]);
    expect(await office(two)).toMatchObject({ level: "districts", name_en: "Hodan", more: 1 });

    const cashier = await createStaff(db, admin, "cash@gmail.com", ["cashier"], [hodan]);
    const pos = await scalar<string>(db, `insert into public.points_of_sale (code, name, district_id, receipt_prefix) values ('HDN1','Hodan office',$1,'HDN1') returning id`, [hodan]);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_pos($1, $2)`, [cashier, pos]));
    expect(await office(cashier)).toMatchObject({ level: "pos", code: "HDN1", name_en: "Hodan office", district_en: "Hodan" });

    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_areas($1, $2)`, [one, JSON.stringify([{ level: "sector", id: sector }])]));
    expect(await office(one)).toMatchObject({ level: "sector", code: "K7", name_en: "Sector 7", district_en: "Hodan", more: 0 });
  });

  it("only admins may look at someone else's office", async () => {
    const a = await createStaff(db, admin, "a@gmail.com", ["customer_service"], [hodan]);
    const b = await createStaff(db, admin, "b@gmail.com", ["customer_service"], [hodan]);
    await expect(office(a, b)).rejects.toThrow(/^PERMISSION_DENIED/);
    expect(await office(admin, b)).toMatchObject({ level: "district" });
  });
});
