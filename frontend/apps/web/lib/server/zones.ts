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
  type Place = { id: string; parent: string; code: string; name_so: string; name_en: string };
  // All ~5,300 neighbourhoods in one answer (the plain list stops at 1,000 rows a request).
  const data = unwrap(await supabase.rpc("zone_places_all", { p_districts: districtIds }), "places") as {
    sections: Place[];
    sectors: Place[];
    neighbourhoods: (Place & { capacity: number | null })[];
  };
  return data;
}
