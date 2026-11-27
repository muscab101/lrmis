import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Banknote, Download } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  BankAccountForm,
  ProviderToggles,
  ReversalQueue,
  ShiftApprovals,
  UnmatchedList,
} from "@/components/payments/queues";
import { Link, redirect } from "@/i18n/navigation";
import { PaymentActions } from "@/components/payments/payment-actions";
import { requirePermission } from "@/lib/server/auth";
import {
  listPayments,
  listProviders,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  paymentFilters,
  queryPayments,
  listReversals,
  listShifts,
  paymentsCounts,
} from "@/lib/server/payments";
import { getProvider } from "@/lib/server/providers";
import { bankAccountForEdit } from "@/lib/server/bank-account";
import { TabCount, tabClass } from "@/components/shell/tabs";
import { Pager } from "@/components/admin/pager";
import { fullHouseNo } from "@/lib/house-no";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("payments");
  return { title: t("title") };
}

const TABS = ["payments", "unmatched", "reversals", "shifts", "providers"] as const;
type Tab = (typeof TABS)[number];

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "payments.view");
  const t = await getTranslations("payments");
  const format = await getFormatter();
  const sp = await searchParams;
  // Statements are worked, explained and approved in Collections now.
  if (sp.tab === "reconciliation")
    redirect({
      href: `/collections?tab=statements${sp.batch ? `&batch=${sp.batch}` : ""}`,
      locale,
    });
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "payments";
  const counts = await paymentsCounts();
  const usd = (n: number | null) =>
    n == null ? "—" : format.number(Number(n), { style: "currency", currency: "USD" });
  const badge: Partial<Record<Tab, number>> = {
    unmatched: counts.unmatched,
    reversals: counts.reversals_pending,
    shifts: counts.shifts_to_approve,
  };

  let body: React.ReactNode;
  let month: number | null = null;
  if (tab === "unmatched")
    body = (
      <UnmatchedList
        rows={await listPayments({ status: "unmatched" })}
        canMatch={viewer.can("payments.approve")}
      />
    );
  else if (tab === "reversals")
    body = (
      <ReversalQueue
        rows={await listReversals(sp.all === "1" ? "any" : "pending")}
        me={viewer.user.id}
        canDecide={viewer.can("payments.approve")}
      />
    );
  else if (tab === "shifts")
    body = (
      <ShiftApprovals
        rows={await listShifts(sp.all === "1" ? "any" : "closed")}
        me={viewer.user.id}
        canApprove={viewer.can("payments.approve")}
      />
    );
  else if (tab === "providers") {
    const providers = await listProviders();
    const configured = Object.fromEntries(
      providers.map((p) => [p.code, getProvider(p.code)?.configured() as boolean | undefined]),
    );
    body = (
      <>
        <ProviderToggles
          providers={providers}
          configured={configured}
          canEdit={viewer.can("settings.update")}
        />
        <BankAccountForm initial={await bankAccountForEdit()} canEdit={viewer.can("settings.update")} />
      </>
    );
  } else {
    const filters = paymentFilters(sp);
    const page = Math.max(1, Number(sp.page) || 1);
    const [{ rows, total, sum, month: thisMonth }, districts] = await Promise.all([queryPayments({ ...filters, page, size: 50 }), listDistricts()]);
    month = thisMonth;
    const keep = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => !!e[1]));
    const exportHref = (fmt: string) => {
      const p = new URLSearchParams(keep);
      p.set("format", fmt);
      return `/api/exports/payments?${p.toString()}`;
    };
    body = (
      <>
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <Input name="q" defaultValue={filters.q} placeholder={t("searchPayments")} aria-label={t("searchPayments")} className="lg:col-span-2" />
          <NativeSelect name="status" defaultValue={filters.status ?? ""} aria-label={t("statusLabel")}>
            <option value="">{t("anyStatus")}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="method" defaultValue={filters.method ?? ""} aria-label={t("method")}>
            <option value="">{t("anyMethod")}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="channel" defaultValue={filters.channel ?? ""} aria-label={t("channel")}>
            <option value="">{t("anyChannel")}</option>
            <option value="desk">{t("channels.desk")}</option>
            <option value="online">{t("channels.online")}</option>
          </NativeSelect>
          <NativeSelect name="district" defaultValue={filters.district ?? ""} aria-label={t("district")}>
            <option value="">{t("anyDistrict")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {locale === "so" ? d.name_so : d.name_en}
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("from")}
            <Input type="date" name="from" defaultValue={filters.from} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("to")}
            <Input type="date" name="to" defaultValue={filters.to} className="flex-1" />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm">
              {t("filter")}
            </Button>
            {keep.toString() && (
              <Button size="sm" variant="ghost" asChild>
                <Link href="/payments">{t("clear")}</Link>
              </Button>
            )}
            <span className="text-sm">
              {t("found", { n: total })} · <span className="font-semibold tabular-nums">{usd(sum)}</span>
            </span>
            {viewer.can("payments.export") && (
              <span className="ms-auto flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={exportHref("xlsx")}>
                    <Download aria-hidden />
                    Excel
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={exportHref("pdf")}>
                    <Download aria-hidden />
                    PDF
                  </a>
                </Button>
              </span>
            )}
          </div>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<Banknote />} title={t("noPayments")} description={t("noPaymentsBody")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("receipt")}</TableHead>
                  <TableHead>{t("pun")}</TableHead>
                  <TableHead>{t("payer")}</TableHead>
                  <TableHead>{t("method")}</TableHead>
                  <TableHead>{t("takenAt")}</TableHead>
                  <TableHead className="text-end">{t("amount")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead className="text-end">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/payments/${p.id}`} className="hover:text-primary">
                        <Mono>{p.receipt_no}</Mono>
                      </Link>
                      <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(p.received_at), { dateStyle: "medium", timeStyle: "short" })}</span>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {p.parcel_id ? (
                        <Link href={`/parcels/${p.parcel_id}`} className="hover:text-primary">
                          <Mono>{p.pun ?? "—"}</Mono>
                        </Link>
                      ) : (
                        "—"
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {[fullHouseNo(p.nb_code, p.house_no), locale === "so" ? p.district_so : p.district_en].filter(Boolean).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-44 text-sm">
                      <span className="block truncate">{p.payer_name ?? "—"}</span>
                      {p.payer_phone && <Mono className="text-xs text-muted-foreground">{p.payer_phone}</Mono>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t(`methods.${p.method}`)}
                      {p.wallet && <span className="text-muted-foreground"> · {t(`wallets.${p.wallet}`)}</span>}
                      {(p.reference || p.provider_ref) && <span className="block max-w-36 truncate font-mono text-xs text-muted-foreground">{p.reference ?? p.provider_ref}</span>}
                      {p.currency !== "USD" && (
                        <span className="block text-xs text-muted-foreground">
                          {format.number(Number(p.amount))} {p.currency}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.online ? t("channels.online") : p.pos_code ? <Mono>{p.pos_code}</Mono> : t("channels.desk")}
                      {p.taken_by && <span className="block text-xs text-muted-foreground">{p.taken_by}</span>}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(p.amount_base)}
                      {Number(p.unallocated) > 0 && <span className="block text-xs text-warning">{t("creditLeftShort", { amount: usd(p.unallocated) })}</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${p.status === "completed" ? "bg-success/10 text-success" : p.status === "reversed" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}
                      >
                        {t(`status.${p.status}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PaymentActions
                        compact
                        id={p.id}
                        status={p.status}
                        unallocated={Number(p.unallocated)}
                        can={{
                          reverse: viewer.can("payments.refund"),
                          applyCredit: viewer.can("payments.create"),
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Pager
          page={page}
          pages={Math.max(1, Math.ceil(total / 50))}
          href={(n) => {
            const p = new URLSearchParams(keep);
            p.set("page", String(n));
            return `/payments?${p.toString()}`;
          }}
        />
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
              href={`/payments?tab=${k}`}
              className={tabClass(tab === k)}
            >
              {t(`tabs.${k}`)}
              {badge[k] !== undefined && (
                <TabCount n={badge[k]} />
              )}
            </Link>
          ))}
        </nav>
      </PageHeader>
      {tab === "payments" && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiChip label={t("kpiToday")} value={usd(counts.today)} />
          <KpiChip label={t("kpiTodayCount")} value={format.number(counts.today_count)} />
          <KpiChip label={t("kpiMonth")} value={usd(month)} />
          <KpiChip label={t("kpiUnmatched")} value={format.number(counts.unmatched)} tone={counts.unmatched ? "warning" : "default"} />
          <KpiChip label={t("kpiShiftsOpen")} value={format.number(counts.shifts_open)} />
        </div>
      )}
      <Card className="overflow-hidden">{body}</Card>
      {(tab === "reversals" || tab === "shifts") && (
        <p className="mt-3 text-sm">
          <Link
            href={`/payments?tab=${tab}${sp.all === "1" ? "" : "&all=1"}`}
            className="text-primary hover:underline"
          >
            {sp.all === "1" ? t("showPendingOnly") : t("showAll")}
          </Link>
        </p>
      )}
    </>
  );
}
