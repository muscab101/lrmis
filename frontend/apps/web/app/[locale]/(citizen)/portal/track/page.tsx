import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Home } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { citizenOverview } from "@/lib/server/portal";

export default async function TrackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portalTrack");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {me.parcels.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">{t("myHouses")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {me.parcels.map((p) => (
              <li key={p.id}>
                <Link href={`/portal/parcels/${p.id}`} className="block rounded-xl border bg-card p-4 hover:border-primary">
                  <div className="flex items-center justify-between gap-3">
                    <Mono>{p.pun ?? "—"}</Mono>
                    <ParcelStatusBadge status={p.status as "registered"} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.district ? (lang === "so" ? p.district.name_so : p.district.name_en) : ""} ·{" "}
                    {p.documents.some((d) => d.type === "certificate") ? t("titleIssued") : t("noTitleYet")}
                    {Number(p.balance) > 0 && ` · ${t("owes", { amount: format.number(Number(p.balance), { style: "currency", currency: "USD" }) })}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.parcels.length === 0 && (
        <Card>
          <EmptyState icon={<Home />} title={t("noHouses")} description={t("noHousesBody")} />
        </Card>
      )}
    </>
  );
}
