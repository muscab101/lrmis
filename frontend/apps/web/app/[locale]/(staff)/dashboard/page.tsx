import { Button } from "@dhulka/ui/button";
import { cn } from "@dhulka/ui/lib/cn";
import { Alert, Mono } from "@dhulka/ui/misc";
import { Banknote, CheckCircle2, ClipboardList, FileBarChart, MapPinned, Users, Wallet } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { AssistantCard } from "@/components/dashboard/assistant-card";
import { Gauge, SplitBars, WeekdayBars } from "@/components/dashboard/mini-charts";
import { DeltaPill, StatCard, change } from "@/components/dashboard/stat-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import { dashboardKpis, dashboardPeriod } from "@/lib/server/reports";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationStatus } from "@dhulka/core/schemas";

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

const RANGES = [7, 30, 90] as const;
const FEE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

/** A card shell in the dashboard's style: title, optional action on the right, content. */
function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("bg-card rounded-xl border p-4 shadow-xs sm:p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ range?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const t = await getTranslations("dashboard");
  const format = await getFormatter();
  const range = (RANGES as readonly number[]).includes(Number((await searchParams).range)) ? Number((await searchParams).range) : 30;

  const canUsers = viewer.can("users.view");
  const supabase = await createClient();
  const [kpis, period, invited] = await Promise.all([
    dashboardKpis(),
    dashboardPeriod(range),
    canUsers ? supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", "invited") : null,
  ]);

  const usd = (n: number, compact = false) =>
    format.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" });
  const count = (n: number) => format.number(Number(n));
  const vsPrev = (v: string) => t("vsPrevious", { value: v });
  const firstName = viewer.profile.full_name.split(" ")[0] ?? "";
  const tasks = (Object.keys(TASK_LINKS) as (keyof typeof TASK_LINKS)[])
    .map((k) => [k, Number(kpis.tasks[k] ?? 0), TASK_LINKS[k]] as const)
    .filter(([, n]) => n > 0);

  // Week starts Monday, like the data (ISO weekday).
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => format.dateTime(new Date(Date.UTC(2024, 0, 1 + i)), { weekday: "short", timeZone: "UTC" }));
  const busiest = period.weekday && Math.max(...period.weekday) > 0 ? weekdayLabels[period.weekday.indexOf(Math.max(...period.weekday))] : null;
  const billed = period.billed;
  const rate = billed && Number(billed.cur) > 0 ? Math.round((1000 * Number(billed.paid_cur)) / Number(billed.cur)) / 10 : null;
  const feeTotal = (period.by_fee ?? []).reduce((s, f) => s + Number(f.amount), 0);
  const fees = (period.by_fee ?? []).slice(0, 3).map((f, i) => ({
    label: locale === "so" ? f.name_so : f.name_en,
    value: usd(f.amount, true),
    share: feeTotal ? (100 * Number(f.amount)) / feeTotal : 0,
    color: FEE_COLORS[i]!,
  }));
  const rangeLabel = `${format.dateTime(new Date(`${period.from}T00:00:00`), { day: "numeric", month: "short" })} – ${format.dateTime(new Date(`${period.to}T00:00:00`), { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-5">
      {/* Header: greeting, period switch and quick actions. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-flag text-xs font-semibold">
            {new Intl.DateTimeFormat(locale === "so" ? "so-SO" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("greeting", { name: firstName })}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("periodSubtitle", { range: rangeLabel })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="bg-card flex rounded-lg border p-0.5 text-sm" aria-label={t("periodLabel")}>
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/dashboard?range=${r}`}
                aria-current={r === range ? "page" : undefined}
                className={cn("rounded-md px-5 py-1 font-medium whitespace-nowrap transition-colors", r === range ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t("lastDays", { days: r })}
              </Link>
            ))}
          </nav>
          {viewer.can("reports.view") && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports">
                <FileBarChart aria-hidden />
                {t("reportsButton")}
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Headline numbers. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {period.collected && (
          <StatCard
            label={t("statCollected")}
            icon={<Banknote />}
            value={usd(period.collected.cur)}
            pct={change(Number(period.collected.cur), Number(period.collected.prev))}
            previous={vsPrev(usd(period.collected.prev))}
            newLabel={t("newLabel")}
          />
        )}
        {period.applications && (
          <StatCard
            label={t("statApplications")}
            icon={<ClipboardList />}
            value={count(period.applications.cur)}
            pct={change(period.applications.cur, period.applications.prev)}
            previous={vsPrev(count(period.applications.prev))}
            newLabel={t("newLabel")}
            tone="flag"
          />
        )}
        {period.registered && (
          <StatCard
            label={t("statRegistered")}
            icon={<MapPinned />}
            value={count(period.registered.cur)}
            pct={change(period.registered.cur, period.registered.prev)}
            previous={t("totalSoFar", { value: count(period.registered.total) })}
            newLabel={t("newLabel")}
            tone="accent"
          />
        )}
        {period.owners && (
          <StatCard
            label={t("statOwners")}
            icon={<Users />}
            value={count(period.owners.cur)}
            pct={change(period.owners.cur, period.owners.prev)}
            previous={t("totalSoFar", { value: count(period.owners.total) })}
            newLabel={t("newLabel")}
            tone="warning"
          />
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {period.series && period.collected && (
            <Panel
              title={t("revenueTitle")}
              action={
                <span className="text-muted-foreground flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="bg-primary h-0.5 w-4 rounded" />
                    {t("collected")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="border-accent w-4 border-t-2 border-dashed" />
                    {t("billed")}
                  </span>
                </span>
              }
            >
              <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
                <div className="space-y-4">
                  <div>
                    <p className="text-3xl font-semibold tracking-tight tabular-nums">{usd(period.collected.cur)}</p>
                    <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                      <DeltaPill pct={change(Number(period.collected.cur), Number(period.collected.prev))} newLabel={t("newLabel")} />
                      {t("vsLastPeriod")}
                    </p>
                  </div>
                  {billed && (
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t("billed")}</dt>
                        <dd className="font-medium tabular-nums">{usd(billed.cur)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t("outstanding")}</dt>
                        <dd className="text-warning font-medium tabular-nums">{usd(billed.outstanding)}</dd>
                      </div>
                    </dl>
                  )}
                </div>
                <TrendChart series={period.series.map((p) => ({ day: p.day, collected: Number(p.collected), billed: Number(p.billed) }))} labels={{ collected: t("collected"), billed: t("billed") }} />
              </div>
              <div className="mt-5 border-t pt-4">
                <p className="text-muted-foreground mb-3 text-xs font-medium">{t("byFeeTitle")}</p>
                {fees.length ? <SplitBars items={fees} /> : <p className="text-muted-foreground text-sm">{t("noPayments")}</p>}
              </div>
            </Panel>
          )}

          {period.recent && (
            <Panel
              title={t("latestApplications")}
              action={
                <Link href="/applications" className="text-primary text-sm hover:underline">
                  {t("viewAll")}
                </Link>
              }
            >
              {period.recent.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noData")}</p>
              ) : (
                <div className="-mx-4 overflow-x-auto sm:-mx-5">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-start text-[11px] font-semibold">
                        <th className="px-4 py-2 text-start sm:px-5">{t("colNumber")}</th>
                        <th className="px-2 py-2 text-start">{t("colOwner")}</th>
                        <th className="px-2 py-2 text-start">{t("colDistrict")}</th>
                        <th className="px-2 py-2 text-start">{t("colDate")}</th>
                        <th className="px-4 py-2 text-end sm:px-5">{t("colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {period.recent.map((a) => (
                        <tr key={a.id} className="hover:bg-muted/40">
                          <td className="px-4 py-2.5 sm:px-5">
                            <Link href={`/applications/${a.id}`} className="hover:text-primary">
                              <Mono>{a.number}</Mono>
                            </Link>
                          </td>
                          <td className="max-w-48 truncate px-2 py-2.5">{a.owners ?? "—"}</td>
                          <td className="px-2 py-2.5">{(locale === "so" ? a.district_so : a.district_en) ?? "—"}</td>
                          <td className="text-muted-foreground px-2 py-2.5 whitespace-nowrap">{format.dateTime(new Date(a.created_at), { dateStyle: "medium" })}</td>
                          <td className="px-4 py-2.5 text-end sm:px-5">
                            <ApplicationStatusBadge status={a.status as ApplicationStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {period.weekday && (
            <Panel title={t("busiestDay")} action={busiest && <span className="text-muted-foreground text-xs">{t("busiestIs", { day: busiest })}</span>}>
              <WeekdayBars values={period.weekday} labels={weekdayLabels} />
            </Panel>
          )}
          {billed && (
            <Panel title={t("collectionRate")}>
              <Gauge pct={rate} label={t("collectionRate")} caption={t("collectionRateCaption")} />
              {period.districts && period.districts.length > 0 && (
                <ul className="mt-5 space-y-2 border-t pt-4 text-sm">
                  <li className="text-muted-foreground text-xs font-medium">{t("topDistricts")}</li>
                  {period.districts.map((d, i) => (
                    <li key={d.name_en} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="bg-muted grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold">{i + 1}</span>
                        <span className="truncate">{locale === "so" ? d.name_so : d.name_en}</span>
                      </span>
                      <span className="font-medium tabular-nums">{usd(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel title={t("tasksTitle")}>
            {tasks.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <CheckCircle2 className="text-success size-4" aria-hidden />
                {t("nothingWaiting")}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {tasks.map(([k, n, href]) => (
                  <li key={k}>
                    <Link href={href} className="hover:text-primary flex items-center justify-between gap-2 py-2">
                      {t(`tasks.${k}`)}
                      <span className="bg-primary-soft text-primary rounded-full px-2 font-mono text-xs font-semibold">{n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {viewer.can("cashier.view") && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/cashier">
                    <Wallet aria-hidden />
                    {t("quickCashier")}
                  </Link>
                </Button>
              )}
            </div>
          </Panel>
          <AssistantCard title={t("assistantTitle")} body={t("assistantBody")} placeholder={t("assistantPlaceholder")} send={t("assistantSend")} />
          {canUsers && (invited?.count ?? 0) > 0 && (
            <Alert tone="warning" title={t("invitedAlertTitle", { count: invited?.count ?? 0 })}>
              <Link href="/admin/users?status=invited" className="underline">
                {t("invitedAlertLink")}
              </Link>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
