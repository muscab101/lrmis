"use server";

import { geometryInputSchema, LOCATION_LEVELS, saveLocationSchema, type LocationInput } from "@dhulka/core/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, fail, unwrap } from "@/lib/server/action";

type Row = Record<string, unknown>;

/** Table columns for each level; the parent column is where `parentId` goes. */
function toRow(input: LocationInput): Row {
  switch (input.level) {
    case "districts":
      return { code: input.code, name_so: input.nameSo, name_en: input.nameEn };
    case "sections":
      return { district_id: input.parentId, code: input.code, name_so: input.nameSo, name_en: input.nameEn };
    case "sectors":
      return { section_id: input.parentId, code: input.code, name_so: input.nameSo, name_en: input.nameEn };
    case "neighbourhoods":
      return {
        sector_id: input.parentId,
        code: input.code,
        name_so: input.nameSo,
        name_en: input.nameEn,
        capacity: input.capacity,
      };
    case "streets":
      return { district_id: input.parentId, name_so: input.nameSo, name_en: input.nameEn };
    case "facilities":
      return { district_id: input.parentId, name_so: input.nameSo, name_en: input.nameEn, kind: input.kind };
  }
}

export const saveLocationAction = defineAction("locations.save", saveLocationSchema, async ({ id, input }, ctx) => {
  const row = toRow(input);
  if (id) {
    const res = await ctx.supabase.from(input.level).update(row).eq("id", id).select("id");
    const data = unwrap(res, "update location") as { id: string }[];
    // RLS hides rows the user may not change: zero rows means no access (or gone).
    if (data.length === 0) fail("PERMISSION_DENIED");
  } else {
    if (input.level === "districts") {
      const region = unwrap(await ctx.supabase.from("regions").select("id").order("created_at").limit(1).single(), "region") as {
        id: string;
      };
      row.region_id = region.id;
    }
    row.created_by = ctx.user.id;
    const res = await ctx.supabase.from(input.level).insert(row).select("id");
    if (res.error?.code === "23505") {
      throw new AppFailure("CONFLICT", undefined, { code: ["validation.code_taken"] });
    }
    unwrap(res, "insert location");
  }
  revalidatePath("/[locale]/locations", "page");
  return null;
});

export const archiveLocationAction = defineAction(
  "locations.archive",
  z.object({ level: z.enum(LOCATION_LEVELS), id: z.uuid(), archived: z.boolean() }),
  async ({ level, id, archived }, ctx) => {
    const res = await ctx.supabase
      .from(level)
      .update({ deleted_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id");
    const data = unwrap(res, "archive location") as { id: string }[];
    if (data.length === 0) fail("PERMISSION_DENIED");
    revalidatePath("/[locale]/locations", "page");
    return null;
  },
);

export const setGeometryAction = defineAction("locations.geometry", geometryInputSchema, async ({ level, id, geojson }, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    throw new AppFailure("VALIDATION", undefined, { geojson: ["validation.geojson"] });
  }
  const out = unwrap(
    await ctx.supabase.rpc("locations_set_geometry", { p_level: level, p_id: id, p_geojson: parsed as never }),
    "set geometry",
  ) as { area_m2: number | null; length_m: number | null };
  revalidatePath("/[locale]/locations", "page");
  return out;
});

export const getGeometryAction = defineAction(
  "locations.get_geometry",
  z.object({ level: z.enum(LOCATION_LEVELS), id: z.uuid() }),
  async ({ level, id }, ctx) =>
    unwrap(await ctx.supabase.rpc("location_geojson", { p_level: level, p_id: id }), "geojson") as {
      geometry: GeoJSON.Geometry;
      bbox: [number, number, number, number];
    } | null,
);

/** The box around the land recorded in a neighbourhood (for one with no boundary drawn yet), or null. */
export const neighbourhoodLandBboxAction = defineAction(
  "locations.neighbourhood_land_bbox",
  z.object({ id: z.uuid() }),
  async ({ id }, ctx) =>
    unwrap(await ctx.supabase.rpc("neighbourhood_land_bbox", { p_id: id }), "land bbox") as [number, number, number, number] | null,
);

/** Children for cascading pickers (district → sections → sectors → neighbourhoods). Small lists; has_geom says
 *  whether each one's boundary is drawn. */
export const listChildrenAction = defineAction(
  "locations.children",
  z.object({ level: z.enum(["sections", "sectors", "neighbourhoods"]), parentId: z.uuid() }),
  async ({ level, parentId }, ctx) => {
    const col = level === "sections" ? "district_id" : level === "sectors" ? "section_id" : "sector_id";
    const res = await ctx.supabase.from(level).select("id, code, name_so, name_en, has_geom").eq(col, parentId).is("deleted_at", null).order("code");
    return unwrap(res, level) as { id: string; code: string; name_so: string; name_en: string; has_geom: boolean }[];
  },
);

export const searchNeighbourhoodsAction = defineAction(
  "locations.search_neighbourhoods",
  z.object({ q: z.string().max(80), districtId: z.uuid().nullable().default(null) }),
  async ({ q, districtId }, ctx) =>
    unwrap(
      await ctx.supabase.rpc("search_neighbourhoods", { p_q: q, p_district_id: districtId, p_limit: 20 }),
      "search neighbourhoods",
    ) as {
      id: string;
      code: string;
      name_so: string;
      name_en: string;
      district_id: string;
      district_code: string;
      district_name_so: string;
      sector_name_so: string;
      has_geom: boolean;
    }[],
);

export const locatePointAction = defineAction(
  "locations.locate_point",
  z.object({ lon: z.number().min(40).max(52), lat: z.number().min(-2).max(12.5) }),
  async ({ lon, lat }, ctx) => {
    const res = await ctx.supabase.rpc("locate_point", { p_lon: lon, p_lat: lat });
    const rows = unwrap(res, "locate point") as {
      neighbourhood_id: string;
      neighbourhood_code: string;
      neighbourhood_name_so: string;
      neighbourhood_name_en: string;
      district_id: string;
      district_code: string;
      district_name_so: string;
      district_name_en: string;
    }[];
    return rows[0] ?? null;
  },
);

/** Delete a location nothing uses (locations.delete); in use → the caller is told to archive it. */
export const deleteLocationAction = defineAction(
  "locations.delete",
  z.object({ level: z.enum(LOCATION_LEVELS), id: z.uuid() }),
  async ({ level, id }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("location_delete", { p_level: level, p_id: id }), "delete location");
    } catch (err) {
      if (err instanceof AppFailure && err.code === "HAS_RECORDS") throw new AppFailure("HAS_RECORDS", undefined, { location: ["validation.location_in_use"] });
      throw err;
    }
    revalidatePath("/[locale]/locations", "page");
    return null;
  },
);
