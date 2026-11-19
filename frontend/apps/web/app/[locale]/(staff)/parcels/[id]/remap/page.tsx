import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RemapEditor } from "@/components/parcels/remap-editor";
import { requireStaff } from "@/lib/server/auth";
import { getParcel } from "@/lib/server/parcels";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("parcels.remap");
  return { title: t("title") };
}

/** Remap: put land already in the system where it really is on the map. The database checks who may do it. */
export default async function RemapPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ back?: string }> }) {
  const { locale, id } = await params;
  // Where to go after saving: back to the remapping list it was opened from (only a page of this site).
  const { back } = await searchParams;
  const backTo = back && /^\/(surveys|parcels)(\/|\?|$)/.test(back) ? back : undefined;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  if (!viewer.can("applications.capture_location")) notFound();
  const t = await getTranslations("parcels.remap");
  const p = await getParcel(id);
  // Flats and compound houses are drawn with their building; demolished, archived and locked land can't be remapped.
  if (!p || !p.geom || p.parent_id || p.locked_at || p.building_state === "demolished" || p.status === "archived") notFound();
  // The pin's colour, as on the land's own page: not registered yet, owing, or paid.
  const partial = p.status === "draft" || p.status === "surveyed" || p.status === "verified";
  const owing =
    !partial &&
    viewer.can("invoices.view") &&
    (await (async () => {
      const supabase = await createClient();
      const { data } = await supabase.from("invoices").select("balance").eq("parcel_id", p.id).in("status", ["issued", "partially_paid"]);
      return ((data ?? []) as { balance: number }[]).some((i) => Number(i.balance) > 0);
    })());
  return (
    <>
      <PageHeader eyebrow={t("title")} title={<Mono>{p.pun ?? p.house_no ?? "—"}</Mono>} />
      <RemapEditor
        parcelId={p.id}
        current={p.geom as GeoJSON.Polygon}
        recordedM2={p.area_m2 == null ? null : Number(p.area_m2)}
        placedByGuess={Boolean(p.geom_provisional)}
        pinState={partial ? "partial" : owing ? "owing" : "paid"}
        backTo={backTo}
      />
    </>
  );
}
