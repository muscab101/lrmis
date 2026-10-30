import { Card } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangeTable, DisputeTable, LienTable, OrderTable } from "@/components/legal/queues";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { legalCounts, listActiveLiens, listActiveOrders, listChanges, listDisputes } from "@/lib/server/legal";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("disputesTitle") };
}

const SECTIONS = ["disputes", "liens", "orders", "changes"] as const;

export default async function DisputesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "disputes.view");
  const t = await getTranslations("legal");
  const sp = await searchParams;
  const section = (SECTIONS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof SECTIONS)[number]) : "disputes";
  const all = sp.all === "1";
  const counts = await legalCounts();
  const me = viewer.user.id;
  const tabCount = { disputes: counts.disputes_open, liens: counts.liens_active, orders: counts.orders_active, changes: counts.changes_waiting };

  let body: React.ReactNode;
  if (section === "liens") body = <LienTable rows={await listActiveLiens()} me={me} canDecide={viewer.can("disputes.approve")} />;
  else if (section === "orders") body = <OrderTable rows={await listActiveOrders()} me={me} canDecide={viewer.can("disputes.approve")} />;
  else if (section === "changes") body = <ChangeTable rows={await listChanges(all ? "any" : "submitted")} canDecide={viewer.can("parcels.approve")} />;
  else body = <DisputeTable rows={await listDisputes(all ? "any" : "open")} me={me} canDecide={viewer.can("disputes.approve")} />;

  return (
    <>
      <PageHeader title={t("disputesTitle")} description={t("disputesSubtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {SECTIONS.map((s) => (
            <Link
              key={s}
              href={`/disputes?s=${s}`}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${section === s ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`sections.${s}`)}
              <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{tabCount[s]}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      {(section === "disputes" || section === "changes") && (
        <p className="mt-3 text-sm">
          <Link href={`/disputes?s=${section}${all ? "" : "&all=1"}`} className="text-primary hover:underline">
            {all ? t("showOpenOnly") : t("showAll")}
          </Link>
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("disputesHint")}</p>
    </>
  );
}
