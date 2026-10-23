import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { StatusBadge } from "@dhulka/ui/badge";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { CopyCheck } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { CorrectionsList } from "@/components/collections/corrections-list";
import { CollectionsDashboardView } from "@/components/collections/dashboard";
import { VerifyTable } from "@/components/collections/verify-table";
import { collectionsDashboard, listCashierDays, listCorrections, listDuplicates, listQueue, VERIFY_STATUSES, type VerifyStatus } from "@/lib/server/collections";
import { type CollectionsCashierRow, type CollectionsRow, runReport } from "@/lib/server/reports";

export async function generateMetadata() {
  const t = await getTranslations("collections");
  return { title: t("title") };
}

const TABS = ["dashboard", "verify", "reconcile", "corrections", "duplicates"] as const;
type Tab = (typeof TABS)[number];

/** ?from=&to= (ISO dates); by default the last 30 days. */
function range(sp: Record<string, string | undefined>) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = iso.test(sp.from ?? "") ? sp.from! : monthAgo;
  const to = iso.test(sp.to ?? "") ? sp.to! : today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export default async function CollectionsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "reconciliation.view");
  const t = await getTranslations("collections");
  const tp = await getTranslations("payments");
  const format = await getFormatter();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : TABS[0];
  const { from, to } = range(sp);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const how = (method: string, wallet: string | null) => (wallet && tp.has(`wallets.${wallet}`) ? tp(`wallets.${wallet}`) : tp.has(`methods.${method}`) ? tp(`methods.${method}`) : method);

  const periodForm = (
    <form className="flex flex-wrap items-end gap-3 p-3 text-sm">
      <input type="hidden" name="tab" value={tab} />
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">{t("from")}</span>
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">{t("to")}</span>
        <Input type="date" name="to" defaultValue={to} className="w-40" />
      </label>
      <Button type="submit" size="sm" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );

  let body: React.ReactNode = null;
  let dashboard: React.ReactNode = null;
  if (tab === "dashboard") {
    const d = await collectionsDashboard();
    // This month by cashier and by day, counting everything recorded (the checked part shows beside it).
    const month = { from: d.month_from, to: d.as_of, basis: "all" as const };
    const [cashiers, days] = await Promise.all([runReport("collectionsCashier", month), runReport("collections", { ...month, by: "day" })]);
    dashboard = <CollectionsDashboardView d={d} cashiers={cashiers as CollectionsCashierRow[]} days={days as CollectionsRow[]} />;
  } else if (tab === "verify") {
    // Status: pending by default; "all" shows every state.
    const status: VerifyStatus | null = sp.status === "all" ? null : VERIFY_STATUSES.includes(sp.status as VerifyStatus) ? (sp.status as VerifyStatus) : "pending";
    const all = await listQueue({ status, from, to });
    const cashiers = [...new Map(all.filter((r) => r.cashier_id).map((r) => [r.cashier_id!, r.cashier ?? "—"])).entries()];
    const cashier = cashiers.some(([id]) => id === sp.cashier) ? sp.cashier! : "";
    const rows = cashier ? all.filter((r) => r.cashier_id === cashier) : all;
    body = (
      <>
        <form className="flex flex-wrap items-end gap-3 p-3 text-sm">
          <input type="hidden" name="tab" value="verify" />
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("statusLabel")}</span>
            <NativeSelect name="status" defaultValue={status ?? "all"} className="w-auto min-w-36">
              {VERIFY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
              <option value="all">{t("status.all")}</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("cashier")}</span>
            <NativeSelect name="cashier" defaultValue={cashier} className="w-auto min-w-40">
              <option value="">{t("allCashiers")}</option>
              {cashiers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("from")}</span>
            <Input type="date" name="from" defaultValue={from} className="w-40" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("to")}</span>
            <Input type="date" name="to" defaultValue={to} className="w-40" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            {t("apply")}
          </Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<CopyCheck />} title={t("verify.none")} description={t("verify.noneBody")} />
        ) : (
          <VerifyTable rows={rows} canVerify={viewer.can("reconciliation.update")} me={viewer.user.id} />
        )}
      </>
    );
  } else if (tab === "reconcile") {
    const days = await listCashierDays(from, to);
    const pendingApproval = days.filter((d) => d.status === "submitted").length;
    body = (
      <>
        {periodForm}
        {pendingApproval > 0 && <p className="border-t px-4 py-2 text-sm text-status-pending">{t("recon.waiting", { count: pendingApproval })}</p>}
        {days.length === 0 ? (
          <EmptyState icon={<CopyCheck />} title={t("recon.noDays")} description={t("recon.noDaysBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("recon.date")}</TableHead>
                <TableHead>{t("cashier")}</TableHead>
                <TableHead className="text-end">{t("recon.payments")}</TableHead>
                <TableHead className="text-end">{t("recon.recorded")}</TableHead>
                <TableHead>{t("recon.checked")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("recon.difference")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => {
                const href = `/collections/reconcile?cashier=${d.cashier_id}&date=${d.business_date}`;
                const st = d.status === "rejected" ? null : d.status;
                return (
                  <TableRow key={`${d.cashier_id}-${d.business_date}`}>
                    <TableCell className="text-sm whitespace-nowrap">{format.dateTime(new Date(`${d.business_date}T00:00:00`), { dateStyle: "medium" })}</TableCell>
                    <TableCell className="text-sm">{d.cashier ?? "—"}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{d.payments}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(d.recorded)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t("recon.checkedLine", { verified: d.verified, pending: d.pending, disputed: d.disputed })}</TableCell>
                    <TableCell>
                      {st ? (
                        <StatusBadge tone={st === "approved" ? "approved" : "pending"}>{t(`recon.status.${st}`)}</StatusBadge>
                      ) : (
                        <StatusBadge tone="draft">{t("recon.status.none")}</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className={`text-end text-sm tabular-nums ${st && d.difference ? (d.difference < 0 ? "text-status-rejected" : "text-status-pending") : ""}`}>
                      {st && d.difference !== null ? usd(d.difference) : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={href} className="text-sm text-primary hover:underline">
                        {st ? t("recon.open") : t("recon.reconcile")}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </>
    );
  } else if (tab === "corrections") {
    const rows = await listCorrections({ status: sp.all === "1" ? "any" : "pending" });
    body = (
      <>
        <p className="border-b px-4 py-2 text-sm">
          <Link href={`/collections?tab=corrections${sp.all === "1" ? "" : "&all=1"}`} className="text-primary hover:underline">
            {sp.all === "1" ? t("corrections.showPending") : t("corrections.showAll")}
          </Link>
        </p>
        <CorrectionsList rows={rows} canDecide={viewer.can("payments.approve")} me={viewer.user.id} />
      </>
    );
  } else if (tab === "duplicates") {
    const rows = await listDuplicates(from, to);
    // Rows come grouped: one group per reference, or per payer + amount + day.
    const groups = [...new Map(rows.map((r) => [`${r.kind}|${r.key}`, rows.filter((x) => x.kind === r.kind && x.key === r.key)])).entries()];
    body = (
      <>
        {periodForm}
        {groups.length === 0 ? (
          <EmptyState icon={<CopyCheck />} title={t("duplicates.none")} description={t("duplicates.noneBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("duplicates.why")}</TableHead>
                <TableHead>{tp("receipt")}</TableHead>
                <TableHead>{tp("received")}</TableHead>
                <TableHead>{tp("method")}</TableHead>
                <TableHead>{tp("reference")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead>{t("cashier")}</TableHead>
                <TableHead className="text-end">{tp("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap(([key, list], gi) =>
                list.map((r, i) => (
                  <TableRow key={`${key}-${r.payment_id}`} className={gi % 2 ? "bg-muted/30" : ""}>
                    <TableCell className="text-sm">{i === 0 ? t(`duplicates.kinds.${r.kind}`) : ""}</TableCell>
                    <TableCell>
                      <Link href={`/payments/${r.payment_id}`} className="text-primary hover:underline">
                        <Mono>{r.receipt_no}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{dt(r.received_at)}</TableCell>
                    <TableCell className="text-sm">{how(r.method, r.wallet)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.reference ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.pun ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.cashier ?? "—"}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(r.amount)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/collections?tab=${k}`}
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      {dashboard ?? <Card className="overflow-hidden">{body}</Card>}
    </>
  );
}
