import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Banknote } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  BankPaymentButton,
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
  listReversals,
  listShifts,
  paymentsCounts,
} from "@/lib/server/payments";
import { getProvider } from "@/lib/server/providers";
import { TabCount, tabClass } from "@/components/shell/tabs";

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
      <ProviderToggles
        providers={providers}
        configured={configured}
        canEdit={viewer.can("settings.update")}
      />
    );
  } else {
    const rows = await listPayments({ status: "any", q: (sp.q ?? "").slice(0, 40) });
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <form role="search">
            <Input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder={t("searchPayments")}
              aria-label={t("searchPayments")}
              className="w-72"
            />
          </form>
          {viewer.can("payments.approve") && (
            <span className="ms-auto">
              <BankPaymentButton />
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Banknote />}
            title={t("noPayments")}
            description={t("noPaymentsBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("receipt")}</TableHead>
                <TableHead>{t("pun")}</TableHead>
                <TableHead>{t("method")}</TableHead>
                <TableHead className="text-end">{t("amount")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("received")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/payments/${p.id}`} className="hover:text-primary">
                      <Mono>{p.receipt_no}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Mono>{p.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`methods.${p.method}`)}
                    {p.currency !== "USD" && (
                      <span className="text-muted-foreground ms-1 text-xs">
                        {format.number(Number(p.amount))} {p.currency}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">
                    {usd(p.amount_base)}
                  </TableCell>
                  <TableCell className="text-sm">{t(`status.${p.status}`)}</TableCell>
                  <TableCell className="text-muted-foreground text-end text-xs">
                    {format.dateTime(new Date(p.received_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
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
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <KpiChip label={t("kpiToday")} value={usd(counts.today)} />
          <KpiChip label={t("kpiTodayCount")} value={format.number(counts.today_count)} />
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
