import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let district: string;
let plot: string;
let surveyor: string;
let other: string;
let clerk: string;
let nbhd: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'39','XW','XW') returning id`, [region]);
  const district2 = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'40','HD','HD') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'01','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','T','T') returning id`, [section]);
  nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'XWKCAA02','N','N') returning id`, [sector]);
  plot = await scalar<string>(
    db,
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, area_m2, geom, geom_provisional)
     values ('391131', '391131', $1, $2, 'registered', now(), 56, extensions.st_setsrid(extensions.st_geomfromgeojson($3), 4326), true) returning id`,
    [district, nbhd, JSON.stringify(square(45.3, 2.04, 0.00004))],
  );
  surveyor = await createStaff(db, admin, "surveyor.remap@dhulka.test", ["surveyor"], [district]);
  other = await createStaff(db, admin, "surveyor.far@dhulka.test", ["surveyor"], [district2]);
  clerk = await createStaff(db, admin, "clerk.remapassign@dhulka.test", ["front_desk_clerk"], [district]);
});

const seen = (user: string) => asUser(db, user, (tx) => scalar<number>(tx, `select count(*)::int from public.parcels where id = $1`, [plot]));

describe("Remap given to a surveyor (0263)", () => {
  it("lists the surveyors of the land's district", async () => {
    const ids = await asUser(db, admin, (tx) => tx.query<{ user_id: string }>(`select user_id from public.parcel_remap_candidates($1)`, [plot]));
    expect(ids.rows.map((r) => r.user_id)).toEqual([surveyor]);
  });

  it("refuses a surveyor from another district, and staff who may not give out work", async () => {
    await expect(asUser(db, admin, (tx) => tx.query(`select public.parcel_remap_assign($1, $2, null)`, [plot, other]))).rejects.toThrow(/not_a_surveyor/);
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.parcel_remap_assign($1, $2, null)`, [plot, surveyor]))).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("the surveyor sees it, remaps it, and the job closes", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_remap_assign($1, $2, 'Old plot, check the corner')`, [plot, surveyor]));
    expect(await seen(surveyor)).toBe(1);
    const told = await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'parcel.remap'`, [surveyor]);
    expect(told).toBe(1);

    await asUser(db, surveyor, (tx) => tx.query(`select public.parcel_remap($1, $2, 'Placed after the visit')`, [plot, JSON.stringify(square(45.305, 2.04, 0.00004))]));
    const p = await scalar<Record<string, unknown>>(db, `select to_jsonb(x) from (select remap_status, geom_provisional, remap_done_at is not null as done from public.parcels where id = $1) x`, [plot]);
    expect(p).toMatchObject({ remap_status: "done", geom_provisional: false, done: true });
    const back = await scalar<number>(db, `select count(*)::int from public.notifications where user_id = $1 and kind = 'parcel.remapped'`, [admin]);
    expect(back).toBe(1);
  });

  it("can be called off", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_remap_assign($1, $2, null)`, [plot, surveyor]));
    await asUser(db, admin, (tx) => tx.query(`select public.parcel_remap_cancel($1)`, [plot]));
    expect(await scalar<string | null>(db, `select remap_status from public.parcels where id = $1`, [plot])).toBeNull();
  });

  it("a whole neighbourhood at once, or only the plots placed by guess", async () => {
    const add = (pun: string, lon: number, guessed: boolean) =>
      scalar<string>(
        db,
        `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, area_m2, geom, geom_provisional)
         values ($1, $1, $2, $3, 'registered', now(), 56, extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326), $5) returning id`,
        [pun, district, nbhd, JSON.stringify(square(lon, 2.04, 0.00004)), guessed],
      );
    await add("391140", 45.31, true);
    await add("391141", 45.311, false);
    const locked = await add("391142", 45.312, true);
    await db.query(`update public.parcels set locked_at = now(), lock_reason = 'Court' where id = $1`, [locked]);

    const sum = await asUser(db, admin, (tx) => tx.query<{ total: number; guessed: number }>(`select total::int, guessed::int from public.neighbourhood_remap_summary($1)`, [nbhd]));
    // The first plot (remapped, no longer by guess) and the two new unlocked ones.
    expect(sum.rows[0]).toEqual({ total: 3, guessed: 1 });

    const n1 = await asUser(db, admin, (tx) => scalar<number>(tx, `select public.neighbourhood_remap_assign($1, $2, null, true)`, [nbhd, surveyor]));
    expect(n1).toBe(1);
    const n2 = await asUser(db, admin, (tx) => scalar<number>(tx, `select public.neighbourhood_remap_assign($1, $2, 'All of it', false)`, [nbhd, surveyor]));
    expect(n2).toBe(2);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.neighbourhood_remap_assign($1, $2, null, false)`, [nbhd, surveyor]))).rejects.toThrow(/nothing_to_remap/);
    await expect(asUser(db, clerk, (tx) => tx.query(`select public.neighbourhood_remap_assign($1, $2, null, false)`, [nbhd, surveyor]))).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.neighbourhood_remap_assign($1, $2, null, false)`, [nbhd, other]))).rejects.toThrow(/not_a_surveyor/);
    expect(await scalar<number>(db, `select count(*)::int from public.parcels where neighbourhood_id = $1 and remap_status = 'assigned'`, [nbhd])).toBe(3);
  });

  it("lists the work by neighbourhood and surveyor, for its own table", async () => {
    type Row = { neighbourhood_id: string; surveyor_id: string; total: number; done: number };
    const q = (user: string, mine: boolean, withDone = false) =>
      asUser(db, user, (tx) => tx.query<Row>(`select neighbourhood_id, surveyor_id, total::int, done::int from public.remap_zone_list($1, $2)`, [mine, withDone]));
    const all = await q(admin, false);
    expect(all.rows).toEqual([{ neighbourhood_id: nbhd, surveyor_id: surveyor, total: 3, done: 0 }]);
    expect((await q(surveyor, true)).rows).toHaveLength(1);
    expect((await q(clerk, false)).rows).toHaveLength(0);

    const one = await scalar<string>(db, `select id from public.parcels where neighbourhood_id = $1 and remap_status = 'assigned' and not geom_provisional limit 1`, [nbhd]);
    await asUser(db, surveyor, (tx) => tx.query(`select public.parcel_remap($1, $2, 'Placed after the visit')`, [one, JSON.stringify(square(45.32, 2.04, 0.00004))]));
    expect((await q(admin, false)).rows[0]).toMatchObject({ total: 3, done: 1 });
    const first = await asUser(db, admin, (tx) => scalar<string>(tx, `select first_open from public.remap_zone_list(false, false)`));
    expect(await scalar<string>(db, `select remap_status from public.parcels where id = $1`, [first])).toBe("assigned");
  });
});
