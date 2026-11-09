import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations } from "next-intl/server";
import { BarChart } from "@/components/reports/bar-chart";
import { Link } from "@/i18n/navigation";
import { CHANNELS, type CollectionsDashboard } from "@/lib/server/collections";
import type { CollectionsCashierRow, CollectionsRow } from "@/lib/server/reports";

/** Collections at a glance: today / week / month, per way of paying, checking status, shortages, cashiers. */
export async function CollectionsDashboardView({ d, cashiers, days }: { d: CollectionsDashboard; cashiers: CollectionsCashierRow[]; days: CollectionsRow[] }) {
  const t = await getTranslations("collections");
  const format = await getFormatter();
  const usd = (n: number | string | undefined) => format.number(Number(n ?? 0), { style: "currency", currency: "USD" });
  const usd0 = (n: number) => format.number(n, { style: "currency", currency: "USD", notation: "compact" });
  const st = (k: "pending" | "verified" | "reconciled" | "disputed") => d.status[k] ?? { n: 0, amount: 0 };
  const monthTotal = CHANNELS.reduce((s, c) => s + Number(d.channels[c] ?? 0), 0);
  const ofVerified = (x: { all: number; verified: number }) => t("dash.verifiedPart", { amount: usd(x.verified) });

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  // One colour per way of paying, used in the share bar and the list.
  const CH_COLOURS = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-status-approved)",
    "var(--color-status-rejected)",
    "var(--color-chart-5)",
  ];
  const checking = [
    { key: "reconciled", n: st("reconciled").n, colour: "var(--color-status-approved)" },
    { key: "verified", n: st("verified").n, colour: "var(--color-chart-2)" },
    { key: "pending", n: st("pending").n, colour: "var(--color-status-pending)" },
    { key: "disputed", n: st("disputed").n, colour: "var(--color-status-rejected)" },
  ] as const;
  const checkingTotal = checking.reduce((s, c) => s + c.n, 0);
  /** A thin bar split by share; an empty grey bar when there is nothing yet. */
  const ShareBar = ({ parts }: { parts: { key: string; value: number; colour: string }[] }) => {
    const total = parts.reduce((s, p) => s + p.value, 0);
    return (
      <div className="bg-muted flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => <span key={p.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(p.value / total) * 100}%`, background: p.colour }} />)}
      </div>
    );
  };
  const Row = ({ colour, label, value, tone }: { colour?: string; label: string; value: string; tone?: string }) => (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
        {colour && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colour }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</span>
    </li>
  );

  return (
    <div className="space-y-5">
      {/* Today, this week, this month: the money, how many payments, and how much of it has been checked. */}
      <div className="grid gap-5 sm:grid-cols-3">
        {(["today", "week", "month"] as const).map((k) => {
          const all = Number(d[k].all);
          const checked = pct(Number(d[k].verified), all);
          return (
            <Card key={k}>
              <CardContent className="space-y-3 pt-5">
                <p className="text-muted-foreground text-sm">{t(`dash.${k}`)}</p>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">{usd(d[k].all)}</p>
                <div className="space-y-1.5">
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                    <div className="h-full rounded-full bg-[var(--color-status-approved)]" style={{ width: `${checked}%` }} />
                  </div>
                  <p className="text-muted-foreground flex justify-between gap-2 text-xs">
                    <span>{t("dash.payments", { count: Number(d[k].n) })}</span>
                    <span>{ofVerified(d[k])}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* This month by way of paying: one bar of shares, then each way with its amount and share. */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-base">{t("dash.byChannel")}</CardTitle>
          <div className="text-end">
            <p className="text-muted-foreground text-xs">{t("dash.grandTotal")}</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{usd(monthTotal)}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ShareBar parts={CHANNELS.map((c, i) => ({ key: c, value: Number(d.channels[c] ?? 0), colour: CH_COLOURS[i % CH_COLOURS.length]! }))} />
          <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNELS.map((c, i) => {
              const v = Number(d.channels[c] ?? 0);
              return (
                <li key={c} className={`flex items-center justify-between gap-3 border-b py-2.5 ${v ? "" : "opacity-60"}`}>
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: CH_COLOURS[i % CH_COLOURS.length] }} />
                    <span className="truncate">{t(`channels.${c}`)}</span>
                  </span>
                  <span className="text-end">
                    <span className="block text-sm font-semibold tabular-nums">{usd(v)}</span>
                    <span className="text-muted-foreground block text-[11px] tabular-nums">{pct(v, monthTotal)}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Checking: where this month's payments stand. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dash.checking")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ShareBar parts={checking.map((c) => ({ key: c.key, value: c.n, colour: c.colour }))} />
            <ul className="divide-y">
              <Row colour="var(--color-chart-2)" label={t("status.verified")} value={String(st("verified").n + st("reconciled").n)} />
              <Row colour="var(--color-status-pending)" label={t("status.pending")} value={String(st("pending").n)} tone={st("pending").n ? "text-status-pending" : ""} />
              <Row colour="var(--color-status-approved)" label={t("status.reconciled")} value={String(st("reconciled").n)} />
              <Row colour="var(--color-status-rejected)" label={t("status.disputed")} value={String(st("disputed").n)} tone={st("disputed").n ? "text-status-rejected" : ""} />
            </ul>
            <p className="text-muted-foreground text-xs">
              {t("dash.checkingLine", { pending: usd(st("pending").amount), disputed: usd(st("disputed").amount) })}{" "}
              {checkingTotal > 0 && (
                <Link href="/collections?tab=verify" className="text-primary font-medium hover:underline">
                  {t("dash.goVerify")}
                </Link>
              )}
            </p>
          </CardContent>
        </Card>

        {/* Reconciliation: money short or over, and what is waiting for a decision. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dash.reconciliation")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/60 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">{t("recon.shortage")}</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${Number(d.shortage) ? "text-status-rejected" : ""}`}>{usd(d.shortage)}</p>
              </div>
              <div className="bg-muted/60 rounded-lg p-3">
                <p className="text-muted-foreground text-xs">{t("recon.excess")}</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${Number(d.excess) ? "text-status-pending" : ""}`}>{usd(d.excess)}</p>
              </div>
            </div>
            <ul className="divide-y">
              {(
                [
                  { label: t("dash.reconWaiting"), n: d.recon_waiting, href: "/collections?tab=reconcile", go: t("dash.goReconcile") },
                  { label: t("dash.correctionsWaiting"), n: d.corrections_waiting, href: "/collections?tab=corrections", go: t("dash.goCorrections") },
                ] as const
              ).map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="group flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm">{r.label}</span>
                      <span className="text-primary block text-xs group-hover:underline">{r.go}</span>
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${r.n ? "bg-status-pending/15 text-status-pending" : "bg-muted text-muted-foreground"}`}
                    >
                      {r.n}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dash.trend")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              label={t("dash.trend")}
              format={usd0}
              data={days.map((x) => ({ label: format.dateTime(new Date(`${String(x.period).slice(0, 10)}T00:00:00`), { day: "numeric", month: "short" }), value: Number(x.total) }))}
            />
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">{t("dash.cashiers")}</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cashier")}</TableHead>
              <TableHead className="text-end">{t("recon.payments")}</TableHead>
              {CHANNELS.map((c) => (
                <TableHead key={c} className="text-end">
                  {t(`channels.${c}`)}
                </TableHead>
              ))}
              <TableHead className="text-end">{t("dash.grandTotal")}</TableHead>
              <TableHead className="text-end">{t("dash.unchecked")}</TableHead>
              <TableHead>{t("dash.daysReconciled")}</TableHead>
              <TableHead className="text-end">{t("recon.shortage")}</TableHead>
              <TableHead className="text-end">{t("recon.excess")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashiers.length === 0 && (
              <TableRow>
                <TableCell colSpan={15} className="text-sm text-muted-foreground">
                  {t("dash.noCashiers")}
                </TableCell>
              </TableRow>
            )}
            {cashiers.map((r) => (
              <TableRow key={r.cashier_id ?? "online"}>
                <TableCell className="text-sm">
                  {r.cashier_id ? (
                    <Link href={`/collections?tab=verify&status=all&cashier=${r.cashier_id}&from=${d.month_from}`} className="text-primary hover:underline">
                      {r.cashier}
                    </Link>
                  ) : (
                    t("online")
                  )}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{Number(r.payments)}</TableCell>
                {CHANNELS.map((c) => (
                  <TableCell key={c} className="text-end text-sm tabular-nums">
                    {usd(r[c])}
                  </TableCell>
                ))}
                <TableCell className="text-end text-sm font-medium tabular-nums">{usd(r.total)}</TableCell>
                <TableCell className={`text-end text-sm tabular-nums ${Number(r.unchecked) ? "text-status-pending" : ""}`}>{usd(r.unchecked)}</TableCell>
                <TableCell className="text-sm">{r.cashier_id ? `${r.reconciled_days} / ${r.days}` : "—"}</TableCell>
                <TableCell className={`text-end text-sm tabular-nums ${Number(r.shortage) ? "text-status-rejected" : ""}`}>{usd(r.shortage)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(r.excess)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
