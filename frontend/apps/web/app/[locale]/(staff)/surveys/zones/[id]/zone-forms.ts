import "server-only";
import { notFound } from "next/navigation";
import type { Viewer } from "@/lib/server/auth";
import { listPropertyTypes } from "@/lib/server/property-types";
import { listBuildingTypes } from "@/lib/server/valuation";
import { listDistricts } from "@/lib/server/users";
import { listZones } from "@/lib/server/zones";
import { createClient } from "@/lib/supabase/server";

/** What the zone's New owner / Add land pages need: the zone, the user's districts, house types and where to start. */
export async function zoneFormData(id: string, viewer: Viewer) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const zone = (await listZones(false, "any")).find((z) => z.id === id);
  if (!zone || zone.status !== "open") notFound();
  if (zone.surveyor_id !== viewer.user.id && !viewer.can("surveys.approve")) notFound();
  const supabase = await createClient();
  const [all, mine, grades, buildingTypes, nbhd] = await Promise.all([
    listDistricts(),
    supabase.rpc("user_district_ids"),
    listPropertyTypes(),
    listBuildingTypes(true),
    supabase.from("neighbourhoods").select("id, district_id, code, name_so, name_en").eq("id", zone.neighbourhood_id).maybeSingle(),
  ]);
  const allowed = new Set((mine.data as string[] | null) ?? []);
  return {
    zone,
    districts: all.filter((d) => allowed.has(d.id)),
    grades,
    buildingTypes,
    start: nbhd.data as { id: string; district_id: string; code: string; name_so: string; name_en: string } | null,
  };
}
