import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar } from "./harness";

let db: PGlite;
let admin: string;
let cashier: string;
let hodan: string;
let wadajir: string;

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  admin = await bootstrapSuperAdmin(db);
  cashier = await createStaff(db, admin, "cashier@gmail.com", ["cashier"], [hodan]);
});

describe("points of sale (0062)", () => {
  it("admins add and edit a desk; codes are unique; cashiers can't", async () => {
    const p = JSON.stringify({ code: "hdn2", name: "Hodan market", district_id: hodan });
    await expect(asUser(db, cashier, (tx) => tx.query(`select public.pos_save(null, $1)`, [p]))).rejects.toThrow(/^PERMISSION_DENIED/);
    const id = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.pos_save(null, $1)`, [p]));
    const row = await scalar<{ code: string; receipt_prefix: string; kind: string }>(db, `select to_jsonb(p) from public.points_of_sale p where id = $1`, [id]);
    expect(row).toMatchObject({ code: "HDN2", receipt_prefix: "HDN2", kind: "cashier" });
    await expect(asUser(db, admin, (tx) => tx.query(`select public.pos_save(null, $1)`, [p]))).rejects.toThrow(/^CONFLICT: pos_code_taken/);
    await asUser(db, admin, (tx) => tx.query(`select public.pos_save($1, $2)`, [id, JSON.stringify({ code: "HDN2", name: "Hodan market desk", district_id: hodan, active: false })]));
    expect(await scalar<boolean>(db, `select active from public.points_of_sale where id = $1`, [id])).toBe(false);
  });

  it("a cashier's desk must be in their districts; a used desk is switched off, not deleted", async () => {
    const hdn = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.pos_save(null, '{"code":"HDN3","name":"Hodan office","district_id":"${hodan}"}')`));
    const wdj = await asUser(db, admin, (tx) => scalar<string>(tx, `select public.pos_save(null, '{"code":"WDJ3","name":"Wadajir office","district_id":"${wadajir}"}')`));
    await expect(asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_pos($1, $2)`, [cashier, wdj]))).rejects.toThrow(/^VALIDATION: pos_not_in_user_districts/);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_user_pos($1, $2)`, [cashier, hdn]));
    expect(await scalar<string>(db, `select point_of_sale_id from public.profiles where user_id = $1`, [cashier])).toBe(hdn);
    await asUser(db, cashier, (tx) => tx.query(`select public.shift_open($1, 0)`, [hdn]));
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.pos_delete($1)`, [hdn]))).toBe("hidden");
    expect(await scalar<string | null>(db, `select point_of_sale_id from public.profiles where user_id = $1`, [cashier])).toBeNull();
    expect(await asUser(db, admin, (tx) => scalar<string>(tx, `select public.pos_delete($1)`, [wdj]))).toBe("deleted");
    const online = await scalar<string>(db, `select id from public.points_of_sale where kind = 'online'`);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.pos_delete($1)`, [online]))).rejects.toThrow(/^CONFLICT: pos_online/);
  });
});
