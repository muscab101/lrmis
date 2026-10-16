import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, KpiChip, PageHeader } from "@dhulka/ui/misc";
import { CheckCircle2 } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { BarChart } from "@/components/reports/bar-chart";
import { Donut, GroupedBars, HBars } from "@/components/reports/charts";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import { dashboardKpis, runReport, type ArrearsRow, type CollectionRow, type IncomeRow, type RevenueRow } from "@/lib/server/reports";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const TASK_LINKS = {
  surveys: "/surveys",
  transfers: "/transfers?f=submitted",
  permits: "/permits",
  changes: "/disputes?s=changes",
  disputes: "/disputes",
  campaigns: "/messages?s=campaigns",
  messages_failed: "/messages?f=failed",
} as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const t = await getTranslations("dashboard");
  const supabase = await createClient();

  const canUsers = viewer.can("users.view");
  const [staff, invited, roles, districts] = await Promise.all([
    canUsers ? supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", "active") : null,
    canUsers ? supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", "invited") : null,
    supabase.from("roles").select("*", { count: "exact", head: true }),
    supabase.from("districts").select("*", { count: "exact", head: true }).is("deleted_at", null),
  ]);

  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const kpis = await dashboardKpis();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const rate = kpis.finance && Number(kpis.finance.billed_year) > 0 ? Math.round((1000 * Number(kpis.finance.paid_year)) / Number(kpis.finance.billed_year)) / 10 : null;
  const tr = await getTranslations("reports");
  const charts = viewer.can("reports.view") ? await loadCharts(locale, (k) => tr(k)) : null;
  const tasks = (Object.keys(TASK_LINKS) as (keyof typeof TASK_LINKS)[])
    .map((k) => [k, Number(kpis.tasks[k] ?? 0), TASK_LINKS[k]] as const)
    .filter(([, n]) => n > 0);

  const firstName = viewer.profile.full_name.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat(locale === "so" ? "so-SO" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
        title={t("greeting", { name: firstName })}
        description={t("subtitle")}
      >
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {canUsers && <KpiChip label={t("kpiActiveStaff")} value={staff?.count ?? "—"} />}
          {canUsers && <KpiChip label={t("kpiInvited")} value={invited?.count ?? "—"} tone={(invited?.count ?? 0) > 0 ? "warning" : "default"} />}
          <KpiChip label={t("kpiRoles")} value={roles.count ?? "—"} />
          <KpiChip label={t("kpiDistricts")} value={districts.count ?? "—"} />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {kpis.finance && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{t("financeTitle")}</CardTitle>
                  <CardDescription>{t("financeBody")}</CardDescription>
                </div>
                {viewer.can("reports.view") && (
                  <Link href="/reports" className="text-sm text-primary hover:underline">
                    {t("viewReports")}
                  </Link>
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-x-10 gap-y-4">
                  <KpiChip label={t("collectedMonth")} value={usd(kpis.finance.collected_month)} tone="success" />
                  <KpiChip label={t("collectedYear")} value={usd(kpis.finance.collected_year)} />
                  <KpiChip label={t("outstanding")} value={usd(kpis.finance.outstanding)} />
                  <KpiChip label={t("overdue")} value={usd(kpis.finance.overdue)} tone={kpis.finance.overdue > 0 ? "danger" : "default"} />
                  <KpiChip label={t("collectionRate")} value={rate === null ? "—" : `${rate} %`} />
                </div>
                <BarChart
                  label={t("trendLabel")}
                  data={kpis.finance.trend.map((m) => ({ label: format.dateTime(new Date(`${m.month}-01T00:00:00`), { month: "short" }), value: Number(m.amount) }))}
                  format={(n) => format.number(n, { style: "currency", currency: "USD", notation: "compact" })}
                />
              </CardContent>
            </Card>
          )}
          {(kpis.applications || kpis.parcels) && (
            <Card>
              <CardHeader>
                <CardTitle>{t("registryTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-x-10 gap-y-4">
                  {kpis.applications && <KpiChip label={t("kpiOpenApps")} value={kpis.applications.open} />}
                  {kpis.applications && <KpiChip label={t("kpiSubmittedMonth")} value={kpis.applications.submitted_month} />}
                  {kpis.parcels && <KpiChip label={t("kpiRegistered")} value={kpis.parcels.registered} tone="success" />}
                  {kpis.parcels && <KpiChip label={t("kpiRegisteredMonth")} value={kpis.parcels.registered_month} />}
                  {kpis.parcels && <KpiChip label={t("kpiDisputed")} value={kpis.parcels.disputed} tone={kpis.parcels.disputed > 0 ? "warning" : "default"} />}
                </div>
                {kpis.applications && Object.keys(kpis.applications.by_status).length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-medium">{t("pipeline")}</h3>
                    <HBars
                      label={t("pipeline")}
                      format={(n) => String(n)}
                      data={Object.entries(kpis.applications.by_status)
                        .sort((a, b) => b[1] - a[1])
                        .map(([s2, n]) => ({ label: ta.has(`status.${s2}`) ? ta(`status.${s2}`) : s2, value: n, href: `/${locale}/applications?status=${s2}` }))}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {charts && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("cashFlowTitle")}</CardTitle>
                  <CardDescription>{t("cashFlowBody")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <GroupedBars
                    label={t("cashFlowTitle")}
                    format={(n) => format.number(n, { style: "currency", currency: "USD", notation: "compact" })}
                    categories={charts.flow.map((m) => format.dateTime(new Date(`${m.month}-01T00:00:00`), { month: "short" }))}
                    series={[
                      { label: t("moneyIn"), values: charts.flow.map((m) => Number(m.cash_in)), color: "var(--color-status-approved)" },
                      { label: t("moneyOut"), values: charts.flow.map((m) => Number(m.cash_out)), color: "var(--color-status-rejected)" },
                      { label: t("earned"), values: charts.flow.map((m) => Number(m.income)) },
                    ]}
                  />
                </CardContent>
              </Card>
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("byFeeTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {charts.byFee.length ? (
                      <Donut label={t("byFeeTitle")} format={usd} data={charts.byFee} center={usd(charts.byFee.reduce((a, b) => a + b.value, 0))} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("noData")}</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("arrearsTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChart label={t("arrearsTitle")} format={(n) => format.number(n, { style: "currency", currency: "USD", notation: "compact" })} data={charts.arrears} height={140} />
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("byDistrictTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <HBars label={t("byDistrictTitle")} format={usd} data={charts.byDistrict} empty={t("noData")} />
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("tasksTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                  {t("nothingWaiting")}
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {tasks.map(([k, n, href]) => (
                    <li key={k}>
                      <Link href={href} className="flex items-center justify-between gap-2 py-2 hover:text-primary">
                        {t(`tasks.${k}`)}
                        <span className="rounded-sm bg-muted px-1.5 font-mono text-xs">{n}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("securityTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                {viewer.aal === "aal2" ? t("mfaOn") : t("mfaOff")}
              </p>
              <p className="text-muted-foreground">{t("securityBody")}</p>
              <Link href="/change-password" className="text-primary hover:underline">
                {t("changePassword")}
              </Link>
            </CardContent>
          </Card>
          {canUsers && (invited?.count ?? 0) > 0 && (
            <Alert tone="warning" title={t("invitedAlertTitle", { count: invited?.count ?? 0 })}>
              <Link href="/admin/users?status=invited" className="underline">
                {t("invitedAlertLink")}
              </Link>
            </Alert>
          )}
        </div>
      </div>
    </>
  );
}

/** Chart data for report roles. A failing report hides its chart instead of breaking the page. */
async function loadCharts(locale: string, tr: (k: string) => string) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(today);
  const sixAgo = iso(new Date(today.getFullYear(), today.getMonth() - 5, 1));
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const [flow, revenue, arrears, collection] = await Promise.allSettled([
    runReport("income", { from: sixAgo, to }),
    runReport("revenue", { from: yearStart, to }),
    runReport("arrears", { from: to, to }),
    runReport("collection", { from: yearStart, to }),
  ]);
  const ok = <T,>(r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? (r.value as T) : ([] as unknown as T));
  const fees = new Map<string, number>();
  for (const r of ok<RevenueRow[]>(revenue)) {
    const k = locale === "so" ? r.fee_name_so : r.fee_name_en;
    fees.set(k, (fees.get(k) ?? 0) + Number(r.amount));
  }
  const buckets = ["not_due", "d1_30", "d31_90", "d91_180", "d180"] as const;
  const ar = ok<ArrearsRow[]>(arrears);
  return {
    flow: ok<IncomeRow[]>(flow),
    byFee: [...fees.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    arrears: buckets.map((b) => ({ label: tr(`buckets.${b}`), value: ar.reduce((s, x) => s + Number(x[b]), 0) })),
    byDistrict: ok<CollectionRow[]>(collection)
      .map((c) => ({ label: locale === "so" ? c.district_so : c.district_en, value: Number(c.collected) }))
      .sort((a, b) => b.value - a.value),
  };
}
