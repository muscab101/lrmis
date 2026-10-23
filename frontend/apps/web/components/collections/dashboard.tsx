import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { KpiChip } from "@dhulka/ui/misc";
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

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-3">
        {(["today", "week", "month"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="pt-5">
              <KpiChip label={t(`dash.${k}`)} value={usd(d[k].all)} />
              <p className="mt-2 text-xs text-muted-foreground">
                {t("dash.payments", { count: Number(d[k].n) })} · {ofVerified(d[k])}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dash.byChannel")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {CHANNELS.map((c) => (
            <KpiChip key={c} label={t(`channels.${c}`)} value={<span className="text-lg">{usd(d.channels[c])}</span>} />
          ))}
          <KpiChip label={t("dash.grandTotal")} value={<span className="text-lg">{usd(monthTotal)}</span>} tone="success" />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dash.checking")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <KpiChip label={t("status.verified")} value={`${st("verified").n + st("reconciled").n}`} tone="success" />
            <KpiChip label={t("status.pending")} value={`${st("pending").n}`} tone={st("pending").n ? "warning" : "default"} />
            <KpiChip label={t("status.reconciled")} value={`${st("reconciled").n}`} tone="success" />
            <KpiChip label={t("status.disputed")} value={`${st("disputed").n}`} tone={st("disputed").n ? "danger" : "default"} />
            <p className="col-span-2 text-xs text-muted-foreground">
              {t("dash.checkingLine", { pending: usd(st("pending").amount), disputed: usd(st("disputed").amount) })}{" "}
              <Link href="/collections?tab=verify" className="text-primary hover:underline">
                {t("dash.goVerify")}
              </Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dash.reconciliation")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <KpiChip label={t("recon.shortage")} value={usd(d.shortage)} tone={Number(d.shortage) ? "danger" : "default"} />
            <KpiChip label={t("recon.excess")} value={usd(d.excess)} tone={Number(d.excess) ? "warning" : "default"} />
            <KpiChip label={t("dash.reconWaiting")} value={`${d.recon_waiting}`} tone={d.recon_waiting ? "warning" : "default"} />
            <KpiChip label={t("dash.correctionsWaiting")} value={`${d.corrections_waiting}`} tone={d.corrections_waiting ? "warning" : "default"} />
            <p className="col-span-2 text-xs text-muted-foreground">
              <Link href="/collections?tab=reconcile" className="text-primary hover:underline">
                {t("dash.goReconcile")}
              </Link>
              {" · "}
              <Link href="/collections?tab=corrections" className="text-primary hover:underline">
                {t("dash.goCorrections")}
              </Link>
            </p>
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
