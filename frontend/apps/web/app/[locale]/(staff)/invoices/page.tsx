import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  ChevronDown,
  Eye,
  Filter,
  Receipt,
} from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { NumberPager } from "@/components/admin/number-pager";
import { InvoiceTools } from "@/components/billing/invoice-tools";
import { InvoicePrintNow } from "@/components/billing/invoice-print-now";
import { PAGE_SIZES } from "@/components/billing/page-sizes";
import { EntriesSelect } from "@/components/billing/table-controls";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import {
  billingCounts,
  INVOICE_LANDS,
  type InvoiceLand,
  INVOICE_SORTS,
  listInvoiceTable,
  type InvoiceFilter,
  type InvoiceSort,
} from "@/lib/server/billing";
import { NativeSelect } from "@dhulka/ui/form-controls";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("invoicesTitle") };
}

const FILTERS: InvoiceFilter[] = ["open", "overdue", "paid", "cancelled", "any"];

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "invoices.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const canCollect = viewer.can("cashier.view");
  const canPrint = viewer.can("invoices.print");
  const filter = (FILTERS as string[]).includes(sp.f ?? "") ? (sp.f as InvoiceFilter) : "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await billingCounts();
  // One list; the filter can narrow it to registered land or land in partial registration.
  const land = (INVOICE_LANDS as readonly string[]).includes(sp.land ?? "") ? (sp.land as InvoiceLand) : undefined;
  let body: React.ReactNode;
  {
    const size = (PAGE_SIZES as readonly number[]).includes(Number(sp.size)) ? Number(sp.size) : 10;
    const sort = (INVOICE_SORTS as readonly string[]).includes(sp.sort ?? "")
      ? (sp.sort as InvoiceSort)
      : undefined;
    const dir = sp.dir === "asc" ? "asc" : "desc";
    const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = isDate(sp.from) ? sp.from : undefined;
    const to = isDate(sp.to) ? sp.to : undefined;
    const fee = ["property_bill", "service_charge"].includes(sp.fee ?? "") ? sp.fee : undefined;
    const q = (sp.q ?? "").slice(0, 40);
    const { rows, total } = await listInvoiceTable({
      filter,
      q,
      page,
      pageSize: size,
      sort,
      dir,
      from,
      to,
      feeCode: fee,
      land,
    });
    // Everything the URL carries, so sorting, paging and the page size keep the filter and search.
    const query: Record<string, string> = Object.fromEntries(
      Object.entries({
        land,
        f: filter,
        q,
        from,
        to,
        fee,
        sort,
        dir: sort ? dir : undefined,
        size: String(size),
      }).filter(([, v]) => v),
    ) as Record<string, string>;
    const link = (over: Record<string, string | undefined>) => {
      const next = new URLSearchParams(
        Object.entries({ ...query, ...over }).filter(([, v]) => v) as [string, string][],
      );
      return `/invoices?${next.toString()}`;
    };
    const day = (d: string) =>
      format.dateTime(new Date(`${d.slice(0, 10)}T00:00:00`), { dateStyle: "medium" });
    const when = (d: string) => format.dateTime(new Date(d), { timeStyle: "short" });
    const money = (n: number) =>
      format.number(Number(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const Sort = ({
      by,
      children,
      end,
    }: {
      by: InvoiceSort;
      children: React.ReactNode;
      end?: boolean;
    }) => (
      <Link
        href={link({
          sort: by,
          dir: sort === by && dir === "desc" ? "asc" : "desc",
          page: undefined,
        })}
        className={`hover:text-foreground inline-flex items-center gap-1 ${sort === by ? "text-primary" : ""} ${end ? "flex-row-reverse" : ""}`}
      >
        {children}
        {sort === by ? (
          dir === "asc" ? (
            <ArrowUp className="size-3.5" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
        )}
      </Link>
    );
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <form className="flex items-center text-sm" role="search">
            {Object.entries(query)
              .filter(([k]) => k !== "q")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <Input
              id="invoice-search"
              name="q"
              defaultValue={q}
              placeholder={t("searchInvoices")}
              aria-label={t("table.search")}
              className="w-72"
            />
          </form>
          <details className="relative">
            <summary className="bg-primary text-primary-foreground inline-flex h-9 cursor-pointer select-none list-none items-center gap-1.5 rounded-md px-4 text-sm font-medium">
              <Filter className="size-4" aria-hidden />
              {t("table.filter")}
              <ChevronDown className="size-4" aria-hidden />
            </summary>
            <form className="bg-popover absolute start-0 z-20 mt-2 grid w-80 gap-3 rounded-lg border p-4 shadow-sm">
              <input type="hidden" name="size" value={size} />
              {q && <input type="hidden" name="q" value={q} />}
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground text-xs">{t("statusLabel")}</span>
                <select
                  name="f"
                  defaultValue={filter}
                  className="bg-background h-9 rounded-md border px-2"
                >
                  {FILTERS.map((f) => (
                    <option key={f} value={f}>
                      {t(`filters.${f}`)}
                      {f === "overdue" && counts.invoices_overdue > 0
                        ? ` (${counts.invoices_overdue})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground text-xs">{t("table.landFilter")}</span>
                <NativeSelect name="land" defaultValue={land ?? ""} className="h-9 w-auto">
                  <option value="">{t("land_any")}</option>
                  {INVOICE_LANDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`land_${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground text-xs">{t("feeType")}</span>
                <select
                  name="fee"
                  defaultValue={fee ?? ""}
                  className="bg-background h-9 rounded-md border px-2"
                >
                  <option value="">{t("table.allFees")}</option>
                  <option value="property_bill">{t("table.taxBill")}</option>
                  <option value="service_charge">{t("table.serviceCharge")}</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-muted-foreground text-xs">{t("table.from")}</span>
                  <Input type="date" name="from" defaultValue={from ?? ""} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-muted-foreground text-xs">{t("table.to")}</span>
                  <Input type="date" name="to" defaultValue={to ?? ""} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Link
                  href={`/invoices?size=${size}`}
                  className="hover:bg-muted inline-flex h-9 items-center rounded-md border px-3 text-sm"
                >
                  {t("table.clear")}
                </Link>
                <Button type="submit" size="sm">
                  {t("table.apply")}
                </Button>
              </div>
            </form>
          </details>
          <EntriesSelect size={size} query={query} />
          <span className="ms-auto" />
          <InvoiceTools canFixDuplicates={viewer.can("invoices.cancel")} canCreateMissing={viewer.can("invoices.create")} canEditAmount={viewer.can("invoices.update")} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title={t("noInvoices")}
            description={t("noInvoicesBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Sort by="issue_date">{t("table.transactionDate")}</Sort>
                </TableHead>
                <TableHead>
                  <Sort by="due_date">{t("table.dateDue")}</Sort>
                </TableHead>
                <TableHead>{t("table.pun")}</TableHead>
                <TableHead>
                  <Sort by="number">{t("table.reference")}</Sort>
                </TableHead>
                <TableHead className="text-end">
                  <Sort by="total" end>
                    {t("table.amount")}
                  </Sort>
                </TableHead>
                <TableHead className="text-end">
                  <Sort by="paid" end>
                    {t("paid")}
                  </Sort>
                </TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap text-sm">{day(i.issue_date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {day(i.due_date)}
                    <span className="text-muted-foreground block text-xs">
                      {when(i.created_at)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {i.parcel ? (
                      <Link href={`/parcels/${i.parcel.id}`} className="hover:text-primary">
                        <Mono className="whitespace-nowrap">{i.parcel.pun ?? "—"}</Mono>
                      </Link>
                    ) : (
                      "—"
                    )}
                    {/* The account and phone sit under the PUN, so the actions fit without scrolling. */}
                    {i.account_no && <Mono className="text-muted-foreground block text-xs">{i.account_no}</Mono>}
                    {i.phone && (
                      <span dir="ltr" className="text-muted-foreground block text-xs tabular-nums">
                        {i.phone}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                      <Mono>{i.number}</Mono>
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      {i.fee_type ? (lang === "so" ? i.fee_type.name_so : i.fee_type.name_en) : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{money(i.total)}</TableCell>
                  <TableCell className="text-end text-sm font-medium tabular-nums">
                    {money(i.paid)}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={i.status} dueDate={i.due_date} />
                    {i.demolished_land ? (
                      <span className="text-muted-foreground block pt-1 text-xs">{t("landDemolishedShort")}</span>
                    ) : (
                      i.partial_land && <span className="text-muted-foreground block pt-1 text-xs">{t("landPartialShort")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                        <Link
                          href={`/invoices/${i.id}`}
                          aria-label={t("viewInvoice")}
                          title={t("viewInvoice")}
                        >
                          <Eye aria-hidden />
                        </Link>
                      </Button>
                      {i.status !== "cancelled" && canPrint && <InvoicePrintNow id={i.id} iconOnly />}
                      {/* Only registered land's bills can be paid. */}
                      {canCollect &&
                        !i.demolished_land &&
                        Number(i.balance) > 0 &&
                        (i.status === "issued" || i.status === "partially_paid") && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-status-approved"
                            asChild
                          >
                            <Link
                              href={`/cashier?find=${encodeURIComponent(i.number)}`}
                              aria-label={t("takePayment")}
                              title={t("takePayment")}
                            >
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
        <NumberPager
          page={page}
          pages={Math.max(1, Math.ceil(total / size))}
          total={total}
          size={size}
          href={(p) => link({ page: String(p) })}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("invoicesTitle")} description={t("invoicesSubtitle")} />
      <Card className="overflow-hidden">{body}</Card>
    </>
  );
}
