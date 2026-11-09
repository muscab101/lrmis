import { StatusBadge } from "@dhulka/ui/badge";
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
  const tp = await getTranslations("portal");
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
                    {/* Demolished land stays on the register, but the citizen sees it as demolished. */}
                    {p.demolished ? <StatusBadge tone="rejected">{tp("demolishedBadge")}</StatusBadge> : <ParcelStatusBadge status={p.status as "registered"} />}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.district ? (lang === "so" ? p.district.name_so : p.district.name_en) : ""} ·{" "}
                    {p.documents.some((d) => d.type === "certificate") ? t("titleIssued") : t("noTitleYet")}
                    {/* Only registered land's bills are shown as owed; partial or demolished land waits for the district office. */}
                    {Number(p.balance) > 0 && !p.partial && !p.demolished && ` · ${t("owes", { amount: format.number(Number(p.balance), { style: "currency", currency: "USD" }) })}`}
                  </p>
                  {(p.partial || p.demolished) && (
                    <p className="bg-status-pending/10 text-status-pending mt-2 rounded-md px-3 py-2 text-xs">
                      {tp(p.demolished ? "demolishedNotice" : "partialNotice", { district: p.district ? (lang === "so" ? p.district.name_so : p.district.name_en) : "" })}
                    </p>
                  )}
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
