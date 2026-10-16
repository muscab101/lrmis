import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Compass } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { querySurveys, surveyStatusCounts, type SurveyStatus } from "@/lib/server/surveys";

export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return { title: t("title") };
}

const TABS = ["open", "assigned", "in_progress", "overlap_review", "returned", "submitted", "any"] as const;

export default async function SurveysPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "surveys.view");
  const t = await getTranslations("surveys");
  const format = await getFormatter();
  const sp = await searchParams;
  const status = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof TABS)[number]) : "open";
  const mine = sp.mine === "1" || !viewer.can("surveys.approve");
  const [rows, counts] = await Promise.all([querySurveys({ status: status as SurveyStatus | "open" | "any", mine }), surveyStatusCounts()]);
  const count = (tab: (typeof TABS)[number]) =>
    tab === "open"
      ? (["assigned", "in_progress", "returned", "overlap_review"] as const).reduce((s, k) => s + (counts[k] ?? 0), 0)
      : tab === "any"
        ? Object.values(counts).reduce((s, n) => s + (n ?? 0), 0)
        : (counts[tab] ?? 0);
  const href = (p: Record<string, string>) => `/surveys?${new URLSearchParams({ status, ...(mine ? { mine: "1" } : {}), ...p })}`;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${status === tab ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${tab}`)}
              <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{count(tab)}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Compass />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("application")}</TableHead>
                <TableHead>{t("place")}</TableHead>
                <TableHead>{t("surveyor")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("due")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/surveys/${s.id}`} className="hover:text-primary">
                      <Mono>{s.application?.number ?? "—"}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.application?.district?.name_so}
                    {s.application?.neighbourhood && <span className="text-muted-foreground"> · {s.application.neighbourhood.name_so}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{s.surveyor?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{t(`status.${s.status}`)}</TableCell>
                  <TableCell className="text-end text-xs text-muted-foreground">{s.due_date ? format.dateTime(new Date(s.due_date), { dateStyle: "medium" }) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
