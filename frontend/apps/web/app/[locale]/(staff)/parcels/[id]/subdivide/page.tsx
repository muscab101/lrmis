import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubdivideEditor } from "@/components/legal/subdivide-editor";
import { requirePermission } from "@/lib/server/auth";
import { parcelLegal } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("subdivideTitle") };
}

export default async function SubdividePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "parcels.update");
  const t = await getTranslations("legal");
  const p = await getParcel(id);
  if (!p || !p.geom) notFound();
  const legal = await parcelLegal(p.id);
  return (
    <>
      <PageHeader eyebrow={t("subdivideTitle")} title={<Mono>{p.pun ?? "—"}</Mono>} />
      <SubdivideEditor parcelId={p.id} parent={p.geom as GeoJSON.Polygon} blockers={legal.blockers.subdivide} />
    </>
  );
}
