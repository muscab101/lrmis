import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubdivideEditor } from "@/components/legal/subdivide-editor";
import { requirePermission } from "@/lib/server/auth";
import { parcelLegal } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("correctBoundary") };
}

/** Data Correction of a registered parcel's boundary: drawn here, approved by a second person. */
export default async function CorrectBoundaryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.update");
  if (!viewer.can("applications.capture_location")) notFound();
  const t = await getTranslations("legal");
  const p = await getParcel(id);
  if (!p || !p.geom) notFound();
  const legal = await parcelLegal(p.id);
  // Liens and unpaid bills don't stop a correction; disputes, freeze orders and pending changes do.
  const blockers = legal.blockers.subdivide.filter((b) => ["dispute", "freeze_order", "pending_change", "archived", "not_registered"].includes(b));
  return (
    <>
      <PageHeader eyebrow={t("correctBoundary")} title={<Mono>{p.pun ?? "—"}</Mono>} />
      <SubdivideEditor parcelId={p.id} parent={p.geom as GeoJSON.Polygon} blockers={blockers} variant="correct" />
    </>
  );
}
