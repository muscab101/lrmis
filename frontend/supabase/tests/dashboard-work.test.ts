import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let surveyor: string;

type Panel = { panel: string; items: { key: string; n: number }[] };
const panels = (user: string) => asUser(db, user, (tx) => scalar<Panel[]>(tx, `select public.dashboard_work()`));

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
  surveyor = await createStaff(db, admin, "surveyor@gmail.com", ["surveyor"], [hodan]);
});

describe("dashboard: my work (0214)", () => {
  it("each role gets the panels of its own job", async () => {
    expect((await panels(cashier)).map((p) => p.panel)).toContain("cashier");
    expect((await panels(cashier)).map((p) => p.panel)).not.toContain("admin");
    const s = await panels(surveyor);
    expect(s.map((p) => p.panel)).toContain("surveyor");
    expect(s.find((p) => p.panel === "surveyor")!.items.map((i) => i.key)).toEqual(["my_zones", "my_site_checks", "my_surveys"]);
    const all = (await panels(admin)).map((p) => p.panel);
    expect(all).toEqual(expect.arrayContaining(["surveys", "registration", "cashier", "collections", "billing", "valuation", "legal", "accounting", "printing", "admin"]));
  });
});
