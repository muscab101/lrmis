import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, asUser, bootstrapSuperAdmin, createDb, createStaff, scalar, square } from "./harness";

let db: PGlite;
let admin: string;
let gisHodan: string;
let hodan: string;
let wadajir: string;
let sectionH: string;
let sectorH: string;
let nbhd: string;

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(`^${code}`));
}

beforeAll(async () => {
  db = await createDb();
  const region = await scalar<string>(db, `insert into public.regions (code, name_so, name_en) values ('BN','Banaadir','Banadir') returning id`);
  hodan = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'HDN','Hodan','Hodan') returning id`, [region]);
  wadajir = await scalar<string>(db, `insert into public.districts (region_id, code, name_so, name_en) values ($1,'WDJ','Wadajir','Wadajir') returning id`, [region]);
  admin = await bootstrapSuperAdmin(db);
  gisHodan = await createStaff(db, admin, "gis@gmail.com", ["gis_officer"], [hodan]);
});

describe("hierarchy", () => {
  it("staff create sections → sectors → neighbourhoods; district follows the parent", async () => {
    await asUser(db, admin, async (tx) => {
      sectionH = await scalar<string>(tx, `insert into public.sections (district_id, code, name_so, name_en) values ($1,'S1','Qaybta 1','Section 1') returning id`, [hodan]);
      // district_id given here is wrong on purpose: the trigger overrides it from the section.
      sectorH = await scalar<string>(tx, `insert into public.sectors (section_id, district_id, code, name_so, name_en) values ($1,$2,'K1','Kaabta 1','Sector 1') returning id`, [sectionH, wadajir]);
      nbhd = await scalar<string>(tx, `insert into public.neighbourhoods (sector_id, district_id, code, name_so, name_en, capacity) values ($1,$2,'012','Taleex','Taleh',500) returning id`, [sectorH, wadajir]);
    });
    const r = await db.query<{ s: string; n: string }>(
      `select (select district_id from public.sectors where id=$1) s, (select district_id from public.neighbourhoods where id=$2) n`,
      [sectorH, nbhd],
    );
    expect(r.rows[0]).toEqual({ s: hodan, n: hodan });
  });

  it("neighbourhood codes are unique per district", async () => {
    await expect(
      asUser(db, admin, (tx) => tx.query(`insert into public.neighbourhoods (sector_id, code, name_so, name_en) values ($1,'012','X','X')`, [sectorH])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("a GIS officer of Hodan cannot create sections in Wadajir", async () => {
    await expect(
      asUser(db, gisHodan, (tx) => tx.query(`insert into public.sections (district_id, code, name_so, name_en) values ($1,'S9','X','X')`, [wadajir])),
    ).rejects.toThrow(/row-level security|permission denied/);
  });
});

describe("geometry", () => {
  it("a district's boundary can be saved, and its name is placed inside it", async () => {
    await asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('districts', $1, $2)`, [hodan, JSON.stringify(square(45.34, 2.044, 0.004))]));
    const inside = await scalar<boolean>(db, `select extensions.st_contains(geom, label_point) from public.districts where id = $1`, [hodan]);
    expect(inside).toBe(true);
  });

  it("imports a GeoJSON polygon, repairs it and returns the area", async () => {
    const out = await asUser(db, gisHodan, (tx) =>
      scalar<{ area_m2: number }>(tx, `select public.locations_set_geometry('neighbourhoods', $1, $2)`, [nbhd, JSON.stringify(square(45.3, 2.04))]),
    );
    // 0.004° × 0.004° near the equator ≈ 445 m × 442 m
    expect(out.area_m2).toBeGreaterThan(190_000);
    expect(out.area_m2).toBeLessThan(200_000);
  });

  it("accepts a FeatureCollection and rejects shapes outside Somalia or of the wrong type", async () => {
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: square(45.31, 2.05) }] };
    await asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('sectors', $1, $2)`, [sectorH, JSON.stringify(fc)]));
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('sectors', $1, $2)`, [sectorH, JSON.stringify(square(10, 50))])),
      "VALIDATION: outside Somalia",
    );
    await expectError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.locations_set_geometry('sectors', $1, $2)`, [sectorH, JSON.stringify({ type: "Point", coordinates: [45.3, 2.04] })]),
      ),
      "VALIDATION: wrong geometry type",
    );
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('sectors', $1, '{"type":"nope"}')`, [sectorH])),
      "VALIDATION: geojson",
    );
  });

  it("a neighbourhood can't be drawn in or over another one; touching is fine (0285)", async () => {
    // nbhd (012) is the square 45.298–45.302, 2.038–2.042 from the test above.
    const other = await scalar<string>(
      db,
      `insert into public.neighbourhoods (sector_id, code, name_so, name_en, capacity) values ($1,'099','Inside','Inside',50) returning id`,
      [sectorH],
    );
    const save = (g: unknown) => asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('neighbourhoods', $1, $2)`, [other, JSON.stringify(g)]));
    // Inside 012, and half over it: refused, naming 012.
    await expectError(save(square(45.3, 2.04, 0.001)), "CONFLICT: neighbourhood_overlap: 012");
    await expectError(save(square(45.302, 2.04, 0.002)), "CONFLICT: neighbourhood_overlap: 012");
    // Right next to it, sharing only the edge: saved.
    await save({ type: "Polygon", coordinates: [[[45.302, 2.036], [45.306, 2.036], [45.306, 2.044], [45.302, 2.044], [45.302, 2.036]]] });
    expect(await scalar<boolean>(db, `select geom is not null from public.neighbourhoods where id = $1`, [other])).toBe(true);
    // And 012 can't now be stretched over its neighbour either.
    await expectError(
      asUser(db, admin, (tx) => tx.query(`select public.locations_set_geometry('neighbourhoods', $1, $2)`, [nbhd, JSON.stringify(square(45.302, 2.04, 0.004))])),
      "CONFLICT: neighbourhood_overlap: 099",
    );
  });

  it("a user without locations.update cannot change geometry", async () => {
    const cashier = await createStaff(db, admin, "cash@gmail.com", ["cashier"], [hodan]);
    await expectError(
      asUser(db, cashier, (tx) => tx.query(`select public.locations_set_geometry('neighbourhoods', $1, $2)`, [nbhd, JSON.stringify(square(45.3, 2.04))])),
      "PERMISSION_DENIED",
    );
  });

  it("audit records that geometry changed without storing the geometry", async () => {
    const row = await scalar<{ after: Record<string, unknown> }>(
      db,
      `select jsonb_build_object('after', after) from public.audit_log where table_name='neighbourhoods' and record_id=$1 and action='update' order by id desc limit 1`,
      [nbhd],
    );
    expect(row.after.geom_changed).toBe(true);
    expect(row.after.geom).toBeUndefined();
  });
});

describe("lookups and tiles", () => {
  it("locates a pin inside the neighbourhood", async () => {
    const hit = await asUser(db, gisHodan, (tx) => tx.query<{ neighbourhood_code: string; district_code: string }>(`select * from public.locate_point(45.3005, 2.0402)`));
    expect(hit.rows[0]).toMatchObject({ neighbourhood_code: "012", district_code: "HDN" });
    const miss = await asUser(db, gisHodan, (tx) => tx.query(`select * from public.locate_point(45.5, 2.3)`));
    expect(miss.rows).toHaveLength(0);
  });

  it("searches neighbourhoods by name, typo-tolerant, and by code", async () => {
    const byName = await asUser(db, gisHodan, (tx) => tx.query<{ code: string }>(`select code from public.search_neighbourhoods('Talex')`));
    expect(byName.rows.map((r) => r.code)).toContain("012");
    const byCode = await asUser(db, gisHodan, (tx) => tx.query<{ name_so: string }>(`select name_so from public.search_neighbourhoods('01')`));
    expect(byCode.rows[0]?.name_so).toBe("Taleex");
  });

  it("tile function is public, empty below the zoom threshold, and the extent covers mapped areas", async () => {
    // ST_AsMVT encoding needs protobuf, which PGlite's PostGIS build lacks; real tiles are
    // checked against the Supabase project (see docs/phase-2.md). Here: gating + extent.
    const low = await as(db, "anon", {}, (tx) => scalar<Uint8Array>(tx, `select public.location_tile('neighbourhoods', 8, 0, 0)`));
    expect(low.byteLength).toBe(0);
    await expectError(as(db, "anon", {}, (tx) => tx.query(`select public.location_tile('parcels', 14, 0, 0)`)), "VALIDATION: layer");
    const extent = await as(db, "anon", {}, (tx) => scalar<number[]>(tx, `select public.locations_extent()`));
    expect(extent[0]).toBeCloseTo(45.298, 2);
  });

  it("anonymous visitors cannot read the location tables directly", async () => {
    await expect(as(db, "anon", {}, (tx) => tx.query(`select * from public.neighbourhoods`))).rejects.toThrow(/permission denied/);
  });

  it("location pins: sections and sectors with a point, for staff only", async () => {
    await asUser(db, admin, (tx) =>
      tx.query(`update public.sections set point = extensions.st_setsrid(extensions.st_makepoint(45.3, 2.04), 4326),
                  point_confidence = 'low', point_source = 'test' where id = $1`, [sectionH]),
    );
    const pins = await asUser(db, gisHodan, (tx) => scalar<{ features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] }>(tx, `select public.location_pins()`));
    const pin = pins.features.find((f) => f.properties.id === sectionH);
    expect(pin?.properties).toMatchObject({ level: "section", confidence: "low", source: "test" });
    expect(pin?.geometry.coordinates).toEqual([45.3, 2.04]);
    // A sector with no point of its own sits on its section's point, flagged as inherited.
    const sector = pins.features.find((f) => f.properties.id === sectorH);
    expect(sector?.properties).toMatchObject({ level: "sector", inherited: true, confidence: "low", section_id: sectionH });
    expect(sector?.geometry.coordinates).toEqual([45.3, 2.04]);
    await expect(as(db, "anon", {}, (tx) => tx.query(`select public.location_pins()`))).rejects.toThrow(/permission denied/);
  });
});
