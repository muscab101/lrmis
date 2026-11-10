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
import { ChannelsTab, StatementsTab } from "@/components/collections/finance-tabs";
import { AutoSubmitForm } from "@/components/forms/auto-submit-form";
import { CollectionsDashboardView } from "@/components/collections/dashboard";
import { PointOfSaleTab } from "@/components/collections/point-of-sale";
import {
  collectionsDashboard,
  collectionsPosChoices,
  listCashierDays,
  listCorrections,
  listDuplicates,
} from "@/lib/server/collections";
import { type CollectionsCashierRow, type CollectionsRow, runReport } from "@/lib/server/reports";

export async function generateMetadata() {
  const t = await getTranslations("collections");
  return { title: t("title") };
}

const TABS = [
  "dashboard",
  "pos",
  "channels",
  "statements",
  "reconcile",
  "corrections",
  "duplicates",
] as const;
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

export default async function CollectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "reconciliation.view");
  const t = await getTranslations("collections");
  const tp = await getTranslations("payments");
  const format = await getFormatter();
  const sp = await searchParams;
  // The old Verify tab is now part of Point of sale.
  const asked = sp.tab === "verify" ? "pos" : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as Tab) : TABS[0];
  const { from, to } = range(sp);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const dt = (s: string) =>
    format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const how = (method: string, wallet: string | null) =>
    wallet && tp.has(`wallets.${wallet}`)
      ? tp(`wallets.${wallet}`)
      : tp.has(`methods.${method}`)
        ? tp(`methods.${method}`)
        : method;

  const periodForm = (
    <form className="flex flex-wrap items-end gap-3 p-3 text-sm">
      <input type="hidden" name="tab" value={tab} />
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">{t("from")}</span>
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">{t("to")}</span>
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
    const [cashiers, days] = await Promise.all([
      runReport("collectionsCashier", month),
      runReport("collections", { ...month, by: "day" }),
    ]);
    dashboard = (
      <CollectionsDashboardView
        d={d}
        cashiers={cashiers as CollectionsCashierRow[]}
        days={days as CollectionsRow[]}
      />
    );
  } else if (tab === "pos") {
    // Point of sale: choose one, see every cashier, open a cashier's info (money by way of paying, every owner who paid).
    body = <PointOfSaleTab sp={sp} from={from} to={to} me={viewer.user.id} canApprove={viewer.can("reconciliation.update")} superAdmin={viewer.isSuperAdmin} />;
  } else if (tab === "channels") {
    body = (
      <>
        {periodForm}
        <div className="border-t">
          <ChannelsTab from={from} to={to} />
        </div>
      </>
    );
  } else if (tab === "statements") {
    const batch = sp.batch && /^[0-9a-f-]{36}$/i.test(sp.batch) ? sp.batch : undefined;
    const status = ["open", "submitted", "approved", "rejected"].includes(sp.status ?? "")
      ? (sp.status as "open")
      : null;
    body = <StatementsTab batchId={batch} status={status} viewer={viewer} />;
  } else if (tab === "reconcile") {
    // One point of sale, or all: the same choice as on Point of sale, applied as soon as it changes.
    const choices = await collectionsPosChoices();
    const posId = choices.some((c) => c.id === sp.pos) ? sp.pos! : null;
    const days = await listCashierDays(from, to, posId);
    const place = (c: { district_so: string | null; district_en: string | null }) => (locale === "so" ? c.district_so : c.district_en) ?? "";
    const pendingApproval = days.filter((d) => d.status === "submitted").length;
    body = (
      <>
        <AutoSubmitForm key={`${posId ?? "all"}-${from}-${to}`} className="flex flex-wrap items-end gap-3 p-3 text-sm">
          <input type="hidden" name="tab" value="reconcile" />
          <label className="grid gap-1">
            <span className="text-muted-foreground text-xs">{t("pos.search")}</span>
            <NativeSelect name="pos" defaultValue={posId ?? ""} className="w-auto min-w-64">
              <option value="">{t("pos.all")}</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {[`${c.code} · ${c.name}`, place(c)].filter(Boolean).join(" — ")}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground text-xs">{t("from")}</span>
            <Input type="date" name="from" defaultValue={from} className="w-40" />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground text-xs">{t("to")}</span>
            <Input type="date" name="to" defaultValue={to} className="w-40" />
          </label>
        </AutoSubmitForm>
        {pendingApproval > 0 && (
          <p className="text-status-pending border-t px-4 py-2 text-sm">
            {t("recon.waiting", { count: pendingApproval })}
          </p>
        )}
        {days.length === 0 ? (
          <EmptyState
            icon={<CopyCheck />}
            title={t("recon.noDays")}
            description={t("recon.noDaysBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("recon.date")}</TableHead>
                <TableHead>{t("cashier")}</TableHead>
                <TableHead>{t("pos.search")}</TableHead>
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
                    <TableCell className="whitespace-nowrap text-sm">
                      {format.dateTime(new Date(`${d.business_date}T00:00:00`), {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                    <TableCell className="text-sm">{d.cashier ?? "—"}</TableCell>
                    <TableCell className="text-sm">{d.pos_names ?? "—"}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{d.payments}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(d.recorded)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {t("recon.checkedLine", {
                        verified: d.verified,
                        pending: d.pending,
                        disputed: d.disputed,
                      })}
                    </TableCell>
                    <TableCell>
                      {st ? (
                        <StatusBadge tone={st === "approved" ? "approved" : "pending"}>
                          {t(`recon.status.${st}`)}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="draft">{t("recon.status.none")}</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-end text-sm tabular-nums ${st && d.difference ? (d.difference < 0 ? "text-status-rejected" : "text-status-pending") : ""}`}
                    >
                      {st && d.difference !== null ? usd(d.difference) : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      <Link href={href} className="text-primary text-sm hover:underline">
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
          <Link
            href={`/collections?tab=corrections${sp.all === "1" ? "" : "&all=1"}`}
            className="text-primary hover:underline"
          >
            {sp.all === "1" ? t("corrections.showPending") : t("corrections.showAll")}
          </Link>
        </p>
        <CorrectionsList
          rows={rows}
          canDecide={viewer.can("payments.approve")}
          me={viewer.user.id}
        />
      </>
    );
  } else if (tab === "duplicates") {
    const rows = await listDuplicates(from, to);
    // Rows come grouped: one group per reference, or per payer + amount + day.
    const groups = [
      ...new Map(
        rows.map((r) => [
          `${r.kind}|${r.key}`,
          rows.filter((x) => x.kind === r.kind && x.key === r.key),
        ]),
      ).entries(),
    ];
    body = (
      <>
        {periodForm}
        {groups.length === 0 ? (
          <EmptyState
            icon={<CopyCheck />}
            title={t("duplicates.none")}
            description={t("duplicates.noneBody")}
          />
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
                    <TableCell className="text-sm">
                      {i === 0 ? t(`duplicates.kinds.${r.kind}`) : ""}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/payments/${r.payment_id}`}
                        className="text-primary hover:underline"
                      >
                        <Mono>{r.receipt_no}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{dt(r.received_at)}</TableCell>
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
              className={`-mb-px whitespace-nowrap border-b-2 pb-2 ${tab === k ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
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
