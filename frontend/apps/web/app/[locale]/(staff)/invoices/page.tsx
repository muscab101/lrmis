import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, ChevronDown, Download, Eye, Filter, Receipt } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { NumberPager } from "@/components/admin/number-pager";
import { InvoicePrintNow } from "@/components/billing/invoice-print-now";
import { InvoiceTools } from "@/components/billing/invoice-tools";
import { PAGE_SIZES } from "@/components/billing/page-sizes";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { EntriesSelect } from "@/components/billing/table-controls";
import { Link } from "@/i18n/navigation";
import { fullHouseNo } from "@/lib/house-no";
import { requirePermission } from "@/lib/server/auth";
import { billingCounts, INVOICE_LANDS, invoicePage, invoicePageFilters, type InvoiceFilter, type InvoicePageSort } from "@/lib/server/billing";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("invoicesTitle") };
}

// "All" first: the page opens on every bill, paid ones included.
const FILTERS: InvoiceFilter[] = ["any", "open", "overdue", "paid", "cancelled"];

/** Every bill in the user's districts: totals, search, filters, sorting, export, and the land and owner of each. */
export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "invoices.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const sp = await searchParams;
  const canPrint = viewer.can("invoices.print");
  const canCollect = viewer.can("cashier.view");
  const f = invoicePageFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const size = (PAGE_SIZES as readonly number[]).includes(Number(sp.size)) ? Number(sp.size) : 10;
  const supabase = await createClient();
  const [{ rows, total, sums }, counts, districts, fees, periods] = await Promise.all([
    invoicePage({ ...f, page, size }),
    billingCounts(),
    listDistricts(),
    supabase.from("fee_types").select("code, name_so, name_en, active").order("sort").order("name_en"),
    supabase.from("invoices").select("period").order("period", { ascending: false }).limit(1000),
  ]);
  const years = [...new Set(((periods.data ?? []) as { period: string }[]).map((r) => r.period.slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))];
  const nm = (o: { name_so: string | null; name_en: string | null }) => (locale === "so" ? o.name_so : o.name_en) ?? "";

  // Everything the URL carries, so sorting, paging and the page size keep the filter and search.
  const query: Record<string, string> = Object.fromEntries(
    Object.entries({
      f: f.filter !== "any" ? f.filter : undefined,
      land: f.land,
      fee: f.fee,
      district: f.district,
      period: f.period,
      q: f.q,
      from: f.from,
      to: f.to,
      sort: f.sort,
      dir: f.sort ? f.dir : undefined,
      size: String(size),
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const link = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...query, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/invoices?${next.toString()}`;
  };
  const exportHref = (fmt: string) => {
    const p = new URLSearchParams(Object.entries(query).filter(([k]) => k !== "size"));
    p.set("format", fmt);
    return `/api/exports/invoices?${p.toString()}`;
  };
  const day = (d: string) => format.dateTime(new Date(`${d.slice(0, 10)}T00:00:00`), { dateStyle: "medium" });
  const money = (n: number) => format.number(Number(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const filtered = Object.keys(query).some((k) => k !== "size" && k !== "sort" && k !== "dir");

  const Sort = ({ by, children, end }: { by: InvoicePageSort; children: React.ReactNode; end?: boolean }) => (
    <Link
      href={link({ sort: by, dir: f.sort === by && f.dir === "desc" ? "asc" : "desc", page: undefined })}
      className={`inline-flex items-center gap-1 hover:text-foreground ${f.sort === by ? "text-primary" : ""} ${end ? "flex-row-reverse" : ""}`}
    >
      {children}
      {f.sort === by ? (
        f.dir === "asc" ? (
          <ArrowUp className="size-3.5" aria-hidden />
        ) : (
          <ArrowDown className="size-3.5" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
      )}
    </Link>
  );

  return (
    <>
      <PageHeader title={t("invoicesTitle")} description={t("invoicesSubtitle")}>
        {/* The totals of everything the filters match (cancelled bills left out). */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiChip label={t("sums.count")} value={format.number(total)} />
          <KpiChip label={t("sums.billed")} value={usd(sums.billed)} />
          <KpiChip label={t("sums.paid")} value={usd(sums.paid)} tone="success" />
          <KpiChip label={t("sums.outstanding")} value={usd(sums.outstanding)} tone={sums.outstanding > 0 ? "warning" : "default"} />
          <Link href={link({ f: "overdue", page: undefined })} className="hover:opacity-80">
            <KpiChip label={t("sums.overdue", { n: sums.overdue_count })} value={usd(sums.overdue)} tone={sums.overdue > 0 ? "danger" : "default"} />
          </Link>
        </div>
      </PageHeader>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <form className="flex items-center text-sm" role="search">
            {Object.entries(query)
              .filter(([k]) => k !== "q")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <Input id="invoice-search" name="q" defaultValue={f.q} placeholder={t("searchInvoicesMore")} aria-label={t("table.search")} className="w-80" />
          </form>
          <details className="relative">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground select-none">
              <Filter className="size-4" aria-hidden />
              {t("table.filter")}
              {filtered && <span className="rounded bg-primary-foreground/20 px-1.5 text-xs">✓</span>}
              <ChevronDown className="size-4" aria-hidden />
            </summary>
            <form className="absolute start-0 z-20 mt-2 grid w-[22rem] gap-3 rounded-lg border bg-popover p-4 shadow-sm">
              <input type="hidden" name="size" value={size} />
              {f.q && <input type="hidden" name="q" value={f.q} />}
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{t("statusLabel")}</span>
                <NativeSelect name="f" defaultValue={f.filter} className="h-9 w-auto">
                  {FILTERS.map((x) => (
                    <option key={x} value={x}>
                      {t(`filters.${x}`)}
                      {x === "overdue" && counts.invoices_overdue > 0 ? ` (${counts.invoices_overdue})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{t("table.landFilter")}</span>
                <NativeSelect name="land" defaultValue={f.land ?? ""} className="h-9 w-auto">
                  <option value="">{t("land_any")}</option>
                  {INVOICE_LANDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`land_${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{t("feeType")}</span>
                <NativeSelect name="fee" defaultValue={f.fee ?? ""} className="h-9 w-auto">
                  <option value="">{t("table.allFees")}</option>
                  {((fees.data ?? []) as { code: string; name_so: string; name_en: string; active: boolean }[]).map((x) => (
                    <option key={x.code} value={x.code}>
                      {nm(x)}
                      {x.active ? "" : ` (${t("off")})`}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{t("district")}</span>
                  <NativeSelect name="district" defaultValue={f.district ?? ""} className="h-9 w-auto">
                    <option value="">{t("anyDistrict")}</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {nm(d)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{t("year")}</span>
                  <NativeSelect name="period" defaultValue={f.period ?? ""} className="h-9 w-auto">
                    <option value="">{t("anyYear")}</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{t("table.from")}</span>
                  <Input type="date" name="from" defaultValue={f.from ?? ""} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{t("table.to")}</span>
                  <Input type="date" name="to" defaultValue={f.to ?? ""} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Link href={`/invoices?size=${size}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">
                  {t("table.clear")}
                </Link>
                <Button type="submit" size="sm">
                  {t("table.apply")}
                </Button>
              </div>
            </form>
          </details>
          <EntriesSelect size={size} query={query} />
          {filtered && (
            <Link href={`/invoices?size=${size}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              {t("table.clear")}
            </Link>
          )}
          <span className="ms-auto flex flex-wrap items-center gap-2">
            {viewer.can("invoices.export") && (
              <>
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
              </>
            )}
            <InvoiceTools canFixDuplicates={viewer.can("invoices.cancel")} canCreateMissing={viewer.can("invoices.create")} canEditAmount={viewer.can("invoices.update")} />
          </span>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt />} title={t("noInvoices")} description={t("noInvoicesBody")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Sort by="number">{t("table.reference")}</Sort>
                  </TableHead>
                  <TableHead>
                    <Sort by="issue_date">{t("table.transactionDate")}</Sort>
                  </TableHead>
                  <TableHead>
                    <Sort by="due_date">{t("table.dateDue")}</Sort>
                  </TableHead>
                  <TableHead>{t("table.pun")}</TableHead>
                  <TableHead>{t("table.owner")}</TableHead>
                  <TableHead>{t("feeType")}</TableHead>
                  <TableHead className="text-end">
                    <Sort by="total" end>
                      {t("table.amount")}
                    </Sort>
                  </TableHead>
                  <TableHead className="text-end">
                    <Sort by="paid" end>
                      {t("table.paid")}
                    </Sort>
                  </TableHead>
                  <TableHead className="text-end">
                    <Sort by="balance" end>
                      {t("table.balance")}
                    </Sort>
                  </TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead className="text-end">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => {
                  const partial = ["draft", "surveyed", "verified"].includes(i.land_status ?? "");
                  const demolished = i.building_state === "demolished";
                  const open = (i.status === "issued" || i.status === "partially_paid") && Number(i.balance) > 0;
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                          <Mono className="whitespace-nowrap">{i.number}</Mono>
                        </Link>
                        <span className="block text-xs text-muted-foreground">{i.period}</span>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{day(i.issue_date)}</TableCell>
                      <TableCell className={`text-sm whitespace-nowrap ${open && i.due_date < new Date().toISOString().slice(0, 10) ? "text-danger" : ""}`}>{day(i.due_date)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {i.parcel_id ? (
                          <Link href={`/parcels/${i.parcel_id}`} className="hover:text-primary">
                            <Mono>{i.pun ?? i.account_no ?? "—"}</Mono>
                          </Link>
                        ) : (
                          "—"
                        )}
                        <span className="block text-xs text-muted-foreground">{[fullHouseNo(i.nb_code, i.house_no), nm({ name_so: i.district_so, name_en: i.district_en })].filter(Boolean).join(" · ")}</span>
                      </TableCell>
                      <TableCell className="max-w-48 text-sm">
                        <span className="block truncate" title={i.owners ?? ""}>
                          {i.owners ?? "—"}
                        </span>
                        {i.phone && (
                          <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                            {i.phone}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{nm({ name_so: i.fee_so, name_en: i.fee_en }) || "—"}</TableCell>
                      <TableCell className="text-end text-sm tabular-nums">{money(i.total)}</TableCell>
                      <TableCell className="text-end text-sm tabular-nums text-success">{Number(i.paid) > 0 ? money(i.paid) : "—"}</TableCell>
                      <TableCell className={`text-end text-sm font-medium tabular-nums ${open ? "text-warning" : ""}`}>{money(i.balance)}</TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={i.status} dueDate={i.due_date} />
                        {demolished ? (
                          <span className="block pt-1 text-xs text-muted-foreground">{t("landDemolishedShort")}</span>
                        ) : (
                          partial && <span className="block pt-1 text-xs text-muted-foreground">{t("landPartialShort")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                            <Link href={`/invoices/${i.id}`} aria-label={t("viewInvoice")} title={t("viewInvoice")}>
                              <Eye aria-hidden />
                            </Link>
                          </Button>
                          {/* Take the money at the cashier: registered land only (district cashiers don't take partial land). */}
                          {canCollect && open && !partial && !demolished && (
                            <Button variant="ghost" size="icon-sm" className="text-success" asChild>
                              <Link href={`/cashier?find=${encodeURIComponent(i.number)}`} aria-label={t("takePayment")} title={t("takePayment")}>
                                <Banknote aria-hidden />
                              </Link>
                            </Button>
                          )}
                          {i.status !== "cancelled" && canPrint && <InvoicePrintNow id={i.id} iconOnly />}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <NumberPager page={page} pages={Math.max(1, Math.ceil(total / size))} total={total} size={size} href={(p) => link({ page: String(p) })} />
      </Card>
    </>
  );
}
