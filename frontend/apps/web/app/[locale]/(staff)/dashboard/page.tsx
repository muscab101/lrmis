import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, KpiChip, PageHeader } from "@dhulka/ui/misc";
import { CheckCircle2 } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { BarChart } from "@/components/reports/bar-chart";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import { dashboardKpis } from "@/lib/server/reports";
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
                  <ul className="grid gap-x-8 text-sm sm:grid-cols-2">
                    {Object.entries(kpis.applications.by_status).map(([s, n]) => (
                      <li key={s} className="flex justify-between border-b py-2">
                        <Link href={`/applications?status=${s}`} className="hover:text-primary">
                          {ta.has(`status.${s}`) ? ta(`status.${s}`) : s}
                        </Link>
                        <span className="font-mono tabular-nums">{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
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
