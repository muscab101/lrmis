import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface ZoneRow {
  id: string;
  neighbourhood_id: string;
  code: string;
  name_so: string;
  name_en: string;
  district_id: string;
  district_so: string;
  district_en: string;
  surveyor_id: string;
  surveyor: string | null;
  target: number;
  note: string | null;
  status: "open" | "done" | "cancelled";
  assigned_at: string;
  assigned_by: string | null;
  recorded: number;
  partial: number;
  registered: number;
}

/** Survey zones with progress. `mine`: only the ones assigned to the caller. */
export async function listZones(mine: boolean, status: "open" | "any" = "open") {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("survey_zone_list", { p_mine: mine, p_status: status }), "zones") as ZoneRow[];
  return rows.map((r) => ({ ...r, recorded: Number(r.recorded), partial: Number(r.partial), registered: Number(r.registered) }));
}

export interface ZonePlace {
  id: string;
  parent: string;
  code: string;
  name_so: string;
  name_en: string;
}

/** Sections, sectors and neighbourhoods (with capacity) for the cascading pickers, in the caller's districts. */
export async function zonePlaces(districtIds: string[]) {
  const supabase = await createClient();
  if (districtIds.length === 0) return { sections: [], sectors: [], neighbourhoods: [] };
  const [sections, sectors, neighbourhoods] = await Promise.all([
    supabase.from("sections").select("id, district_id, code, name_so, name_en").in("district_id", districtIds).is("deleted_at", null).order("code"),
    supabase.from("sectors").select("id, section_id, code, name_so, name_en").in("district_id", districtIds).is("deleted_at", null).order("code"),
    supabase.from("neighbourhoods").select("id, sector_id, code, name_so, name_en, capacity").in("district_id", districtIds).is("deleted_at", null).order("code"),
  ]);
  type S = { id: string; district_id: string; code: string; name_so: string; name_en: string };
  type K = { id: string; section_id: string; code: string; name_so: string; name_en: string };
  type N = { id: string; sector_id: string; code: string; name_so: string; name_en: string; capacity: number | null };
  return {
    sections: ((unwrap(sections, "sections") ?? []) as S[]).map((s) => ({ id: s.id, parent: s.district_id, code: s.code, name_so: s.name_so, name_en: s.name_en })),
    sectors: ((unwrap(sectors, "sectors") ?? []) as K[]).map((s) => ({ id: s.id, parent: s.section_id, code: s.code, name_so: s.name_so, name_en: s.name_en })),
    neighbourhoods: ((unwrap(neighbourhoods, "neighbourhoods") ?? []) as N[]).map((n) => ({
      id: n.id,
      parent: n.sector_id,
      code: n.code,
      name_so: n.name_so,
      name_en: n.name_en,
      capacity: n.capacity,
    })),
  };
}
