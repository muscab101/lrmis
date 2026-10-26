import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
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
  return (
    <MapWorkspace
      initialView={parseView(c)}
      extent={(extent as [number, number, number, number] | null) ?? null}
      canEditLocations={viewer.can("locations.update")}
      canViewParcels={viewer.can("parcels.view")}
      districts={districts ?? []}
    />
  );
}
