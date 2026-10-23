import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ReconDecide } from "@/components/collections/recon-decide";
import { ReconForm } from "@/components/collections/recon-form";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { cashierDaySummary, dayReconciliations, type Reconciliation } from "@/lib/server/collections";

export async function generateMetadata() {
  const t = await getTranslations("collections");
  return { title: t("recon.title") };
}

/** One cashier's day: reconcile it (finance officer) or approve it (Finance Manager). ?cashier=&date= */
export default async function ReconcilePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "reconciliation.view");
  const t = await getTranslations("collections");
  const format = await getFormatter();
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(sp.cashier ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "")) notFound();
  const cashierId = sp.cashier!;
  const date = sp.date!;
  const [channels, recs] = await Promise.all([cashierDaySummary(cashierId, date), dayReconciliations(cashierId, date)]);
  if (channels.every((c) => c.payments === 0) && recs.items.length === 0) notFound();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const active = recs.items.find((r) => r.status !== "rejected") ?? null;
  const rejected = recs.items.filter((r) => r.status === "rejected");
  const own = cashierId === viewer.user.id;

  const lines = (r: Reconciliation) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("recon.channel")}</TableHead>
          <TableHead className="text-end">{t("recon.payments")}</TableHead>
          <TableHead className="text-end">{t("recon.recorded")}</TableHead>
          <TableHead className="text-end">{t("recon.actual")}</TableHead>
          <TableHead className="text-end">{t("recon.difference")}</TableHead>
          <TableHead className="text-end">{t("recon.shortage")}</TableHead>
          <TableHead className="text-end">{t("recon.excess")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.lines.map((l) => (
          <TableRow key={l.channel}>
            <TableCell className="text-sm">{t(`channels.${l.channel}`)}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{l.payments}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(l.recorded)}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(l.actual)}</TableCell>
            <TableCell className={`text-end text-sm tabular-nums ${l.difference < 0 ? "text-status-rejected" : l.difference > 0 ? "text-status-pending" : ""}`}>{usd(l.difference)}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{l.shortage ? usd(l.shortage) : "—"}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{l.excess ? usd(l.excess) : "—"}</TableCell>
          </TableRow>
        ))}
        <TableRow className="font-medium">
          <TableCell>{t("recon.total")}</TableCell>
          <TableCell className="text-end tabular-nums">{r.lines.reduce((s, l) => s + l.payments, 0)}</TableCell>
          <TableCell className="text-end tabular-nums">{usd(r.recorded)}</TableCell>
          <TableCell className="text-end tabular-nums">{usd(r.actual)}</TableCell>
          <TableCell className="text-end tabular-nums">{usd(r.difference)}</TableCell>
          <TableCell className="text-end tabular-nums">{usd(r.lines.reduce((s, l) => s + l.shortage, 0))}</TableCell>
          <TableCell className="text-end tabular-nums">{usd(r.lines.reduce((s, l) => s + l.excess, 0))}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
  const who = (r: Reconciliation) => (
    <div className="space-y-1 px-4 py-3 text-sm">
      <p>
        <span className="text-muted-foreground">{t("recon.preparedBy")}:</span> {r.prepared_by_name ?? "—"} · {dt(r.prepared_at)}
      </p>
      {r.note && <p className="text-muted-foreground">{r.note}</p>}
      {r.decided_at && (
        <p>
          <span className="text-muted-foreground">{r.status === "approved" ? t("recon.approvedBy") : t("recon.rejectedBy")}:</span> {r.decided_by_name ?? "—"} · {dt(r.decided_at)}
          {r.decision_note && ` — ${r.decision_note}`}
        </p>
      )}
    </div>
  );
  const tone = (s: Reconciliation["status"]) => (s === "approved" ? "approved" : s === "rejected" ? "rejected" : "pending");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow={t("recon.title")}
        title={`${recs.cashierName ?? "—"} · ${format.dateTime(new Date(`${date}T00:00:00`), { dateStyle: "full" })}`}
        description={
          <Link href={`/collections?tab=reconcile`} className="text-primary hover:underline">
            {t("recon.back")}
          </Link>
        }
      />
      {active ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mono>{active.number}</Mono>
              <StatusBadge tone={tone(active.status)}>{t(`recon.status.${active.status}`)}</StatusBadge>
            </CardTitle>
            {active.status === "submitted" && viewer.can("reconciliation.approve") && active.prepared_by !== viewer.user.id && !own && <ReconDecide id={active.id} number={active.number} />}
          </CardHeader>
          {lines(active)}
          {who(active)}
        </Card>
      ) : viewer.can("reconciliation.update") && !own ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">{t("recon.enterTitle")}</CardTitle>
          </CardHeader>
          <ReconForm cashierId={cashierId} date={date} channels={channels} />
        </Card>
      ) : (
        <Alert tone="info" title={t("recon.notYet")}>
          {own ? t("recon.ownDay") : t("recon.notYetBody")}
        </Alert>
      )}
      {rejected.map((r) => (
        <Card key={r.id} className="overflow-hidden opacity-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mono>{r.number}</Mono>
              <StatusBadge tone="rejected">{t("recon.status.rejected")}</StatusBadge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lines(r)}
            {who(r)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
