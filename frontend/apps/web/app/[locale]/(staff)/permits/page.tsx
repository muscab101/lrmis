import { Card } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PermitTable } from "@/components/legal/queues";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { legalCounts, listPermits, type RequestStatus } from "@/lib/server/legal";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("permitsTitle") };
}

const FILTERS = ["submitted", "approved", "rejected", "any"] as const;

export default async function PermitsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "permits.view");
  const t = await getTranslations("legal");
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as RequestStatus | "any") : "submitted";
  const [rows, counts] = await Promise.all([listPermits(filter), legalCounts()]);
  return (
    <>
      <PageHeader title={t("permitsTitle")} description={t("permitsSubtitle", { waiting: counts.permits_waiting ?? 0 })} />
      <Card className="overflow-hidden">
        <nav className="flex flex-wrap gap-1.5 border-b p-3 text-sm">
          {FILTERS.map((f) => (
            <Link key={f} href={`/permits?f=${f}`} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {f === "any" ? t("all") : t(`status.${f}`)}
            </Link>
          ))}
        </nav>
        <PermitTable rows={rows} me={viewer.user.id} canDecide={viewer.can("permits.approve")} />
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">{t("permitsHint")}</p>
    </>
  );
}
