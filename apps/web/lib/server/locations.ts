import "server-only";
import type { LocationLevel, LocationsQuery } from "@dhulka/core/schemas";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export const PAGE_SIZE = 50;

export interface LocationRow {
  id: string;
  code: string | null;
  name_so: string;
  name_en: string;
  has_geom: boolean;
  deleted_at: string | null;
  capacity?: number | null;
  kind?: string;
  district: { id: string; code: string; name_so: string; name_en: string } | null;
  section?: { id: string; code: string; name_so: string } | null;
  sector?: { id: string; code: string; name_so: string; section_id: string } | null;
}

const SELECT: Record<LocationLevel, string> = {
  districts: "id, code, name_so, name_en, has_geom, deleted_at",
  sections: "id, code, name_so, name_en, has_geom, deleted_at, district:districts(id, code, name_so, name_en)",
  sectors:
    "id, code, name_so, name_en, has_geom, deleted_at, section:sections(id, code, name_so), district:districts(id, code, name_so, name_en)",
  neighbourhoods:
    "id, code, name_so, name_en, capacity, has_geom, deleted_at, sector:sectors(id, code, name_so, section_id), district:districts(id, code, name_so, name_en)",
  streets: "id, name_so, name_en, has_geom, deleted_at, district:districts(id, code, name_so, name_en)",
  facilities: "id, kind, name_so, name_en, has_geom, deleted_at, district:districts(id, code, name_so, name_en)",
};

const HAS_CODE = new Set<LocationLevel>(["districts", "sections", "sectors", "neighbourhoods"]);

/** Paginated list for one level (RLS: any signed-in user sees active rows). */
export async function queryLocations(q: LocationsQuery): Promise<{ rows: LocationRow[]; total: number }> {
  const supabase = await createClient();
  let req = supabase.from(q.level).select(SELECT[q.level], { count: "exact" });
  req = q.archived === "1" ? req.not("deleted_at", "is", null) : req.is("deleted_at", null);
  if (q.district) req = q.level === "districts" ? req.eq("id", q.district) : req.eq("district_id", q.district);
  const term = q.q.replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    req = req.or(
      [`name_so.ilike.%${term}%`, `name_en.ilike.%${term}%`, ...(HAS_CODE.has(q.level) ? [`code.ilike.${term}%`] : [])].join(","),
    );
  }
  const order = HAS_CODE.has(q.level) ? "code" : "name_so";
  const from = (q.page - 1) * PAGE_SIZE;
  const res = await req.order(order).range(from, from + PAGE_SIZE - 1);
  return { rows: unwrap(res, q.level) as unknown as LocationRow[], total: res.count ?? 0 };
}

export interface DistrictCount {
  district_id: string;
  sections: number;
  sectors: number;
  neighbourhoods: number;
  mapped_neighbourhoods: number;
}

export async function locationCounts(): Promise<DistrictCount[]> {
  const supabase = await createClient();
  const res = await supabase.rpc("location_counts");
  return ((res.data ?? []) as DistrictCount[]).map((c) => ({
    ...c,
    sections: Number(c.sections),
    sectors: Number(c.sectors),
    neighbourhoods: Number(c.neighbourhoods),
    mapped_neighbourhoods: Number(c.mapped_neighbourhoods),
  }));
}
