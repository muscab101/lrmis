import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { myScope } from "@/lib/server/scope";
import { createClient } from "@/lib/supabase/server";
import { MapWorkspace } from "./map-workspace";

export async function generateMetadata() {
  const t = await getTranslations("map");
  return { title: t("title") };
}

function parseView(c: string | undefined) {
  const [lng, lat, z] = (c ?? "").split(",").map(Number);
  if ([lng, lat, z].some((n) => n === undefined || Number.isNaN(n))) return undefined;
  return { center: [lng!, lat!] as [number, number], zoom: z! };
}

export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "map.view");
  const supabase = await createClient();
  const [{ data: extent }, { data: districts }] = await Promise.all([
    supabase.rpc("locations_extent"),
    supabase.from("districts").select("id, code, name_so, name_en, has_geom").is("deleted_at", null).order("code"),
  ]);
  const { c } = await searchParams;
  // Opened without a place in the link: go to the user's own area - their point of sale's district, else the districts
  // they are assigned to. District-wide roles (all districts) keep the whole city.
  let home: [number, number, number, number] | null = null;
  if (!c) {
    const scope = await myScope();
    const ids = scope.pos?.district_id ? [scope.pos.district_id] : scope.all ? [] : scope.districtIds;
    const boxes = (
      await Promise.all(ids.map((id) => supabase.rpc("location_geojson", { p_level: "districts", p_id: id })))
    )
      .map((r) => (r.data as { bbox?: [number, number, number, number] } | null)?.bbox)
      .filter((b): b is [number, number, number, number] => Array.isArray(b) && b.length === 4);
    if (boxes.length)
      home = [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ];
  }
  return (
    <MapWorkspace
      initialView={parseView(c)}
      extent={home ?? (extent as [number, number, number, number] | null) ?? null}
      canEditLocations={viewer.can("locations.update")}
      canViewParcels={viewer.can("parcels.view")}
      canMarkDemolished={viewer.can("parcels.demolish") || viewer.can("parcels.demolish_approve")}
      districts={districts ?? []}
    />
  );
}
