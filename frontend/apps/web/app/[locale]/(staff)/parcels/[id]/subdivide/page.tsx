import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SubdivideEditor } from "@/components/legal/subdivide-editor";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { parcelLegal } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("subdivideTitle") };
}

export default async function SubdividePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.update");
  const t = await getTranslations("legal");
  const p = await getParcel(id);
  if (!p || !p.geom) notFound();
  const legal = await parcelLegal(p.id);
  // New owners can be registered right on this page by staff allowed to create owners.
  const ownerDistricts = viewer.can("owners.create") ? await listDistricts() : null;
  const newOwner = ownerDistricts ? { districts: ownerDistricts, districtId: ownerDistricts.find((d) => d.code === p.district?.code)?.id ?? null } : null;
  const currentOwners = p.parcel_owners.filter((o) => !o.valid_to).map((o) => o.party.full_name);
  return (
    <>
      <PageHeader eyebrow={t("subdivideTitle")} title={<Mono>{p.pun ?? "—"}</Mono>} />
      <SubdivideEditor
        parcelId={p.id}
        parent={p.geom as GeoJSON.Polygon}
        blockers={legal.blockers.subdivide}
        pun={p.pun}
        currentOwners={currentOwners}
        newOwner={newOwner}
      />
    </>
  );
}
