import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Banknote, Eye, Printer, Receipt } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { CreditNoteQueue, PlanQueue } from "@/components/billing/queues";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { billingCounts, listCreditNotes, listInvoices, listPlans, type InvoiceFilter } from "@/lib/server/billing";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("invoicesTitle") };
}

const FILTERS: InvoiceFilter[] = ["open", "overdue", "paid", "cancelled", "any"];
const SECTIONS = ["invoices", "credit", "plans"] as const;

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "invoices.view");
  const canCollect = viewer.can("cashier.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const section = (SECTIONS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof SECTIONS)[number]) : "invoices";
  const filter = (FILTERS as string[]).includes(sp.f ?? "") ? (sp.f as InvoiceFilter) : "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await billingCounts();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const tabCount = { invoices: counts.invoices_open, credit: counts.credit_notes_pending, plans: counts.plans_pending };

  let body: React.ReactNode;
  if (section === "credit") {
    body = <CreditNoteQueue rows={await listCreditNotes(sp.all === "1" ? "any" : "pending")} me={viewer.user.id} canDecide={viewer.can("invoices.approve")} />;
  } else if (section === "plans") {
    body = <PlanQueue rows={await listPlans({ status: sp.all === "1" ? "any" : "pending" })} me={viewer.user.id} canDecide={viewer.can("billing.approve")} />;
  } else {
    const { rows, total } = await listInvoices({ filter, q: (sp.q ?? "").slice(0, 40), page });
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {FILTERS.map((f) => (
              <Link
                key={f}
                href={`/invoices?f=${f}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
                className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(`filters.${f}`)}
                {f === "overdue" && counts.invoices_overdue > 0 && <span className="ms-1.5 font-mono text-[11px] text-status-rejected">{counts.invoices_overdue}</span>}
              </Link>
            ))}
          </nav>
          <form className="ms-auto" role="search">
            <input type="hidden" name="f" value={filter} />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("searchInvoices")} aria-label={t("searchInvoices")} className="w-64" />
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt />} title={t("noInvoices")} description={t("noInvoicesBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoice")}</TableHead>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead>{t("feeType")}</TableHead>
                <TableHead>{t("dueDate")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead className="text-end">{t("balance")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                      <Mono>{i.number}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Mono>{i.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.fee_type ? (lang === "so" ? i.fee_type.name_so : i.fee_type.name_en) : "—"} <span className="text-muted-foreground">{i.period}</span>
                  </TableCell>
                  <TableCell className="text-sm">{format.dateTime(new Date(i.due_date), { dateStyle: "medium" })}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(i.total)}</TableCell>
                  <TableCell className="text-end text-sm font-medium tabular-nums">{usd(i.balance)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={i.status} dueDate={i.due_date} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                        <Link href={`/invoices/${i.id}`} aria-label={t("viewInvoice")} title={t("viewInvoice")}>
                          <Eye aria-hidden />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={`/invoices/${i.id}/print`} aria-label={t("printInvoice")} title={t("printInvoice")}>
                          <Printer aria-hidden />
                        </Link>
                      </Button>
                      {canCollect && Number(i.balance) > 0 && (i.status === "issued" || i.status === "partially_paid") && (
                        <Button variant="ghost" size="icon-sm" className="text-status-approved" asChild>
                          <Link href={`/cashier?find=${encodeURIComponent(i.number)}`} aria-label={t("takePayment")} title={t("takePayment")}>
                            <Banknote aria-hidden />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} pages={Math.max(1, Math.ceil(total / 50))} href={(p) => `/invoices?f=${filter}&page=${p}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("invoicesTitle")} description={t("invoicesSubtitle", { outstanding: usd(counts.outstanding) })}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {SECTIONS.map((s) => (
            <Link
              key={s}
              href={`/invoices?s=${s}`}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${section === s ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`sections.${s}`)}
              <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{tabCount[s]}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      {section !== "invoices" && (
        <p className="mt-3 text-sm">
          <Link href={`/invoices?s=${section}${sp.all === "1" ? "" : "&all=1"}`} className="text-primary hover:underline">
            {sp.all === "1" ? t("showPendingOnly") : t("showAll")}
          </Link>
        </p>
      )}
    </>
  );
}
