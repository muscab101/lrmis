import { Card } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangeTable } from "@/components/legal/queues";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listChanges } from "@/lib/server/legal";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("sections.changes") };
}

/** Parcels → Parcel changes: splitting, merging, change of use and corrections waiting for a decision (or all of them). */
export default async function ParcelChangesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ all?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  const t = await getTranslations("legal");
  const all = (await searchParams).all === "1";
  return (
    <>
      <PageHeader title={t("sections.changes")} description={t("changesSubtitle")} />
      <Card className="overflow-hidden">
        <ChangeTable rows={await listChanges(all ? "any" : "submitted")} canDecide={viewer.can("parcels.approve")} />
      </Card>
      <p className="mt-3 text-sm">
        <Link href={`/parcels/changes${all ? "" : "?all=1"}`} className="text-primary hover:underline">
          {all ? t("showOpenOnly") : t("showAll")}
        </Link>
      </p>
    </>
  );
}
