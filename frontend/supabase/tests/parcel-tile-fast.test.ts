import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, bootstrapSuperAdmin, createDb, scalar, square } from "./harness";

// Land map tiles (0305): pins at every zoom, house outlines only up close, "still owing" from a house's own bills or
// its flats' bills. (PGlite's PostGIS cannot build vector tiles, so the tile itself is checked on the live database.)
let db: PGlite;
let admin: string;

beforeAll(async () => {
  db = await createDb();
  admin = await bootstrapSuperAdmin(db);
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  const district = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'39','XW','XW') returning id`, [region]);
  const section = await scalar<string>(db, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'01','S','S') returning id`, [district]);
  const sector = await scalar<string>(db, `insert into public.sectors (section_id, code, name_so, name_en) values ($1,'01','T','T') returning id`, [section]);
  const nbhd = await scalar<string>(db, `insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'N1','N1','N1') returning id`, [sector]);
  const fee = await scalar<string>(db, `select id from public.fee_types where code = 'property_tax'`);
  // Three registered houses far apart: one owes, one is paid, one is a flats building whose flat owes.
  for (const [pun, lon] of [["OWES", 45.3], ["PAID", 45.31], ["FLATS", 45.32]] as const) {
    await db.query(
      `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, geom)
       values ($1, 'A-' || $1, $2, $3, 'registered', now(), extensions.st_setsrid(extensions.st_geomfromgeojson($4), 4326))`,
      [pun, district, nbhd, JSON.stringify(square(lon, 2.04, 0.00005))],
    );
  }
  await db.query(
    `insert into public.parcels (pun, account_no, district_id, neighbourhood_id, status, registered_at, geom, parent_id, unit_no)
     select 'FLATS-01', 'A-FLATS-01', district_id, neighbourhood_id, 'registered', now(), geom, id, '01' from public.parcels where pun = 'FLATS'`,
  );
  for (const pun of ["OWES", "FLATS-01"]) {
    await db.query(
      `insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total)
       select 'INV-' || $1, id, district_id, $2, '2026', current_date, current_date + 60, 25 from public.parcels where pun = $1`,
      [pun, fee],
    );
    await db.query(`insert into public.invoice_lines (invoice_id, kind, description, amount) select id, 'tax', 'Tax', 25 from public.invoices where number = 'INV-' || $1`, [pun]);
  }
});

describe("land map tiles (0305)", () => {
  it("each pin says whether its house (or one of its flats) still owes", async () => {
    const owing = (src: string) =>
      asUser(db, admin, (tx) =>
        scalar<boolean>(
          tx,
          `select (exists (select 1 from public.invoices i where i.parcel_id = p.id and i.status in ('issued', 'partially_paid'))
                   or exists (select 1 from public.parcels o join public.invoices i on i.parcel_id = o.id
                               where o.parent_id = p.id and i.status in ('issued', 'partially_paid')))
             from public.parcels p where p.pun = $1`,
          [src],
        ),
      );
    expect(await owing("OWES")).toBe(true);
    expect(await owing("PAID")).toBe(false);
    expect(await owing("FLATS")).toBe(true);
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'parcel_tile'`);
    expect(src).toContain("o.parent_id = p.id");
    expect(src).toContain("st_transform(p.centroid, 3857)");
    expect(src).toContain("if p_z >= 16 then");
  });
});

describe("zoomed-out pins (0306)", () => {
  it("pins on the same spot are sent once at zoom 13 and below", async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'parcel_tile'`);
    expect(src).toContain("when p_z <= 13 then st_astext(st_snaptogrid(w.geom, 48)) else w.id end");
    expect(src).toContain("'parcel_pins'");
  });
});
