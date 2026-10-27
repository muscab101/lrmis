import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BarChart3, Download, FileSpreadsheet, FileText } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { AreaFilter } from "@/components/reports/area-filter";
import { AssistantPanel } from "@/components/reports/assistant-panel";
import { BarChart } from "@/components/reports/bar-chart";
import { GroupedBars } from "@/components/reports/charts";
import { ReportPicker } from "@/components/reports/report-picker";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { type Cell, type CellKind, reportTable } from "@/lib/server/report-table";
import {
  accountTotals,
  AREA_REPORTS,
  BASIS_REPORTS,
  BILL_STATUSES,
  billStatus as parseBillStatus,
  CHECK_STATUSES,
  checkStatus as parseCheckStatus,
  COLLECTION_BASIS,
  REVENUE_VIEWS,
  revenueView,
  COLLECTION_BY,
  collectionBasis,
  collectionBy,
  type CollectionsCashierRow,
  collectionsCompare,
  type CollectionsRow,
  collectionsStatus,
  FINANCE_REPORTS,
  POS_REPORTS,
  type BillingRow,
  DISTRICT_REPORTS,
  feeTypeCode,
  PARCEL_KINDS,
  PAYMENT_METHODS,
  paymentMethod,
  type PaymentTypeRow,
  parcelKind,
  RELATED_REPORTS,
  REPORT_GROUPS,
  REPORTS,
  reportArea,
  SNAPSHOT_REPORTS,
  reportRange,
  type IncomeRow,
  runReport,
  type ArrearsRow,
  type CashierRow,
  type CollectionRow,
  type RegistrationRow,
  type ReportName,
  type RevenueRow,
} from "@/lib/server/reports";
import { myDistricts, myPointsOfSale, myScope } from "@/lib/server/scope";
import { listFeeTypes } from "@/lib/server/valuation";
import { CHANNELS } from "@/lib/server/collections";
import { zonePlaces } from "@/lib/server/zones";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "reports.view");
  const t = await getTranslations("reports");
  const tc = await getTranslations("collections");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const report = (REPORTS as readonly string[]).includes(sp.r ?? "")
    ? (sp.r as ReportName)
    : "revenue";
  const { from, to } = reportRange(sp);
  // Only the districts (and desks) the user covers are offered; the figures are limited by the database anyway.
  const districts = await myDistricts();
  const places = await zonePlaces(districts.map((d) => d.id));
  // Each level must sit inside the one above it; anything else is dropped.
  const a = reportArea(sp);
  const district =
    districts.length === 1
      ? districts[0]!.id
      : districts.some((d) => d.id === a.district)
        ? a.district!
        : "";
  const section =
    places.sections.find((x) => x.id === a.section && x.parent === district)?.id ?? "";
  const sector = places.sectors.find((x) => x.id === a.sector && x.parent === section)?.id ?? "";
  const nbhd =
    places.neighbourhoods.find((x) => x.id === a.neighbourhood && x.parent === sector)?.id ?? "";
  const kind = parcelKind(sp.kind);
  // Payments: by way of paying and by fee type.
  const method = report === "payments" ? paymentMethod(sp.method) : null;
  const fee = report === "payments" ? feeTypeCode(sp.fee) : null;
  const feeTypes = report === "payments" ? await listFeeTypes() : [];
  // Collections reports: day / week / month, and verified payments only (default) or everything recorded.
  // Point of sale: a user assigned to a desk sees that desk's takings by default; "all" shows every desk.
  const usesPos = POS_REPORTS.includes(report);
  const [scope, desks] = usesPos ? await Promise.all([myScope(), myPointsOfSale()]) : [null, []];
  // A desk user only ever sees their own desk (the database enforces it too).
  const locked = Boolean(scope?.locked && scope.pos);
  const pos = !usesPos
    ? ""
    : locked
      ? scope!.pos!.id
      : sp.pos === "all"
        ? ""
        : desks.some((p) => p.id === sp.pos)
          ? sp.pos!
          : sp.pos === undefined && scope?.pos && desks.some((p) => p.id === scope.pos!.id)
            ? scope.pos.id
            : "";
  const by = collectionBy(sp.by);
  const basis = collectionBasis(sp.basis);
  const isRevenue = report === "revenue";
  const checkSt = isRevenue ? parseCheckStatus(sp.check) : null;
  const billSt = isRevenue ? parseBillStatus(sp.bill) : null;
  const view = isRevenue ? revenueView(sp.view) : "summary";
  const usesArea = AREA_REPORTS.includes(report);
  const rows = await runReport(report, {
    from,
    to,
    district: district || null,
    kind,
    method,
    feeType: fee,
    by,
    basis,
    pos: pos || null,
    checkStatus: checkSt,
    billStatus: billSt,
    view,
    ...(usesArea
      ? { section: section || null, sector: sector || null, neighbourhood: nbhd || null }
      : {}),
  });
  const usd = (n: number | string) =>
    format.number(Number(n), { style: "currency", currency: "USD" });
  const usd0 = (n: number) =>
    format.number(n, { style: "currency", currency: "USD", notation: "compact" });
  const name = (r: { district_so: string; district_en: string }) =>
    lang === "so" ? r.district_so : r.district_en;
  const usesRange = !SNAPSHOT_REPORTS.includes(report);
  const usesDistrict = DISTRICT_REPORTS.includes(report);
  const qs = new URLSearchParams({
    lang,
    ...(usesRange ? { from, to } : {}),
    ...(usesDistrict && district ? { district } : {}),
    ...(usesArea && section ? { section } : {}),
    ...(usesArea && sector ? { sector } : {}),
    ...(usesArea && nbhd ? { nbhd } : {}),
    ...(report === "parcels" ? { kind } : {}),
    ...(method ? { method } : {}),
    ...(fee ? { fee } : {}),
    ...(report === "collections" ? { by } : {}),
    ...(usesPos ? { pos: pos || "all" } : {}),
    ...(BASIS_REPORTS.includes(report) ? { basis } : {}),
    ...(checkSt ? { check: checkSt } : {}),
    ...(billSt ? { bill: billSt } : {}),
    ...(isRevenue && view === "detail" ? { view } : {}),
  }).toString();
  const areaArgs = {
    from,
    to,
    district: district || null,
    basis,
    pos: pos || null,
    section: section || null,
    sector: sector || null,
    neighbourhood: nbhd || null,
  };
  const [compare, status] = FINANCE_REPORTS.includes(report)
    ? await Promise.all([
        BASIS_REPORTS.includes(report) ? collectionsCompare(areaArgs) : Promise.resolve(null),
        collectionsStatus(areaArgs),
      ])
    : [null, null];
  /** The same filters on another report, so moving between related reports keeps the place and the period. */
  const reportHref = (r: ReportName, over: Record<string, string> = {}) =>
    `/reports?${new URLSearchParams({
      r,
      from,
      to,
      ...(district ? { district } : {}),
      ...(section ? { section } : {}),
      ...(sector ? { sector } : {}),
      ...(nbhd ? { nbhd } : {}),
      ...over,
    }).toString()}`;
  /** A district row opens that district's bills for the same period. */
  const districtBills = (id: string, label: string) => (
    <Link
      href={reportHref("invoices", { district: id, section: "", sector: "", nbhd: "" })}
      className="underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
  const cell = (v: Cell, k: CellKind) =>
    v === null || v === ""
      ? "—"
      : k === "money"
        ? usd(v)
        : k === "int" || k === "num"
          ? format.number(Number(v), { maximumFractionDigits: 2 })
          : k === "pct"
            ? `${format.number(Number(v), { maximumFractionDigits: 1 })} %`
            : k === "datetime"
              ? format.dateTime(new Date(String(v)), { dateStyle: "medium", timeStyle: "short" })
              : String(v);
  const right = (k: CellKind) => k === "money" || k === "int" || k === "num" || k === "pct";
  const PAGE_ROWS = 500;
  const monthLabel = (m: string) =>
    format.dateTime(new Date(`${m}-01T00:00:00`), { month: "short", year: "2-digit" });

  let body: React.ReactNode;
  if (rows.length === 0)
    body = <EmptyState icon={<BarChart3 />} title={t("empty")} description={t("emptyBody")} />;
  else if (
    (report === "revenue" && view === "detail") ||
    !["revenue", "income", "arrears", "collection", "registrations", "cashiers"].includes(report)
  ) {
    // The listing reports draw straight from the same table the PDF and Excel files use.
    const table = await reportTable(report, rows, lang, reportHref);
    const shown = table.rows.slice(0, PAGE_ROWS);
    let chart: React.ReactNode = null;
    if (report === "paymentTypes" || report === "collections" || report === "collectionsCashier") {
      const r = rows as (PaymentTypeRow | CollectionsRow | CollectionsCashierRow)[];
      chart = (
        <CardContent className="pt-5">
          <BarChart
            label={t(`names.${report}`)}
            format={usd0}
            data={
              report === "collections"
                ? (r as CollectionsRow[]).map((x, i) => ({
                    label: String(table.rows[i]?.[0] ?? x.period),
                    value: Number(x.total),
                  }))
                : CHANNELS.map((c) => ({
                    label: tc(`channels.${c}`),
                    value: r.reduce((sum, x) => sum + Number(x[c]), 0),
                  }))
            }
          />
        </CardContent>
      );
    }
    if (report === "billing") {
      const r = rows as BillingRow[];
      const months = [...new Set(r.map((x) => x.month))];
      const sumBy = (m: string, k: "billed" | "collected" | "outstanding") =>
        r.filter((x) => x.month === m).reduce((s, x) => s + Number(x[k]), 0);
      chart = (
        <CardContent className="pt-5">
          <GroupedBars
            label={t("names.billing")}
            format={usd0}
            categories={months.map(monthLabel)}
            series={[
              { label: t("billed"), values: months.map((m) => sumBy(m, "billed")) },
              {
                label: t("collected"),
                values: months.map((m) => sumBy(m, "collected")),
                color: "var(--color-status-approved)",
              },
              {
                label: t("outstanding"),
                values: months.map((m) => sumBy(m, "outstanding")),
                color: "var(--color-status-pending)",
              },
            ]}
          />
        </CardContent>
      );
    }
    body = (
      <>
        {chart}
        <Table>
          <TableHeader>
            <TableRow>
              {table.columns.map((c) => (
                <TableHead key={c.label} className={right(c.kind) ? "text-end" : ""}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r, i) => (
              <TableRow key={i}>
                {r.map((v, j) => {
                  const k = table.columns[j]!.kind;
                  const href = table.links[i]?.[j];
                  return (
                    <TableCell
                      key={j}
                      className={`text-sm ${right(k) ? "text-end tabular-nums" : ""} ${k === "mono" ? "whitespace-nowrap font-mono text-xs" : ""}`}
                    >
                      {href && v !== null && v !== "" ? (
                        <Link
                          href={href}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {cell(v, k)}
                        </Link>
                      ) : (
                        cell(v, k)
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {table.totals && (
              <TableRow>
                {table.totals.map((v, j) => (
                  <TableCell
                    key={j}
                    className={`font-medium ${right(table.columns[j]!.kind) ? "text-end tabular-nums" : ""}`}
                  >
                    {v === null
                      ? ""
                      : j === 0 && !table.columns[0]!.sum
                        ? String(v)
                        : cell(v, table.columns[j]!.kind)}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          {table.rows.length > PAGE_ROWS
            ? t("showing", { shown: PAGE_ROWS, count: table.rows.length })
            : t("rowsCount", { count: table.rows.length })}
        </p>
      </>
    );
  } else if (report === "revenue") {
    const r = rows as RevenueRow[];
    const months = [...new Set(r.map((x) => x.month))];
    body = (
      <>
        <CardContent className="pt-5">
          <BarChart
            label={t("names.revenue")}
            format={usd0}
            data={months.map((m) => ({
              label: monthLabel(m),
              value: r.filter((x) => x.month === m).reduce((s, x) => s + Number(x.amount), 0),
            }))}
          />
        </CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("feeType")}</TableHead>
              <TableHead className="text-end">{t("payments")}</TableHead>
              <TableHead className="text-end">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.map((x) => (
              <TableRow key={x.month + x.fee_type}>
                <TableCell className="font-mono text-sm">{x.month}</TableCell>
                <TableCell className="text-sm">
                  {lang === "so" ? x.fee_name_so : x.fee_name_en}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.payments}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                {t("total")}
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">
                {usd(r.reduce((s, x) => s + Number(x.amount), 0))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  } else if (report === "income") {
    const r = rows as IncomeRow[];
    const accounts = (await accountTotals(from, to)).filter(
      (a) => Number(a.debit) !== 0 || Number(a.credit) !== 0,
    );
    const sum = (k: keyof IncomeRow) => r.reduce((s2, x) => s2 + Number(x[k]), 0);
    body = (
      <>
        <CardContent className="grid gap-6 pt-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("cashFlow")}</h3>
            <GroupedBars
              label={t("cashFlow")}
              format={usd0}
              categories={r.map((x) => monthLabel(x.month))}
              series={[
                {
                  label: t("cashIn"),
                  values: r.map((x) => Number(x.cash_in)),
                  color: "var(--color-status-approved)",
                },
                {
                  label: t("cashOut"),
                  values: r.map((x) => Number(x.cash_out)),
                  color: "var(--color-status-rejected)",
                },
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("earned")}</h3>
            <GroupedBars
              label={t("earned")}
              format={usd0}
              categories={r.map((x) => monthLabel(x.month))}
              series={[
                { label: t("incomeLabel"), values: r.map((x) => Number(x.income)) },
                {
                  label: t("expensesLabel"),
                  values: r.map((x) => Number(x.expenses)),
                  color: "var(--color-status-pending)",
                },
              ]}
            />
          </div>
        </CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead className="text-end">{t("incomeLabel")}</TableHead>
              <TableHead className="text-end">{t("expensesLabel")}</TableHead>
              <TableHead className="text-end">{t("cashIn")}</TableHead>
              <TableHead className="text-end">{t("cashOut")}</TableHead>
              <TableHead className="text-end">{t("netCash")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.map((x) => (
              <TableRow key={x.month}>
                <TableCell className="font-mono text-sm">{x.month}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.income)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.expenses)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.cash_in)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.cash_out)}</TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">
                  {usd(x.net)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">{t("total")}</TableCell>
              {(["income", "expenses", "cash_in", "cash_out", "net"] as const).map((k) => (
                <TableCell key={k} className="text-end font-medium tabular-nums">
                  {usd(sum(k))}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
        {accounts.length > 0 && (
          <>
            <h3 className="border-t px-4 pt-4 text-sm font-medium">{t("byAccount")}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("account")}</TableHead>
                  <TableHead className="text-end">{t("debit")}</TableHead>
                  <TableHead className="text-end">{t("credit")}</TableHead>
                  <TableHead className="text-end">{t("net")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.code}>
                    <TableCell className="text-sm">
                      <Mono className="me-2 text-xs">{a.code}</Mono>
                      {lang === "so" ? a.name_so : a.name_en}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(a.debit)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(a.credit)}</TableCell>
                    <TableCell className="text-end text-sm font-medium tabular-nums">
                      {usd(a.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </>
    );
  } else if (report === "arrears") {
    const r = rows as ArrearsRow[];
    const cols = ["not_due", "d1_30", "d31_90", "d91_180", "d180", "total"] as const;
    body = (
      <>
        <CardContent className="pt-5">
          <BarChart
            label={t("names.arrears")}
            format={usd0}
            data={cols
              .slice(0, 5)
              .map((c) => ({
                label: t(`buckets.${c}`),
                value: r.reduce((s, x) => s + Number(x[c]), 0),
              }))}
          />
        </CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("district")}</TableHead>
              <TableHead className="text-end">{t("invoices")}</TableHead>
              {cols.map((c) => (
                <TableHead key={c} className="text-end">
                  {t(`buckets.${c}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.map((x) => (
              <TableRow key={x.district_id}>
                <TableCell className="text-sm">{districtBills(x.district_id, name(x))}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.invoices}</TableCell>
                {cols.map((c) => (
                  <TableCell
                    key={c}
                    className={`text-end text-sm tabular-nums ${c === "total" ? "font-medium" : ""}`}
                  >
                    {usd(x[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  } else if (report === "collection") {
    const r = rows as CollectionRow[];
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("district")}</TableHead>
            <TableHead className="text-end">{t("invoices")}</TableHead>
            <TableHead className="text-end">{t("billed")}</TableHead>
            <TableHead className="text-end">{t("collected")}</TableHead>
            <TableHead className="text-end">{t("credited")}</TableHead>
            <TableHead className="text-end">{t("outstanding")}</TableHead>
            <TableHead className="text-end">{t("rate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.map((x) => (
            <TableRow key={x.district_id}>
              <TableCell className="text-sm">{districtBills(x.district_id, name(x))}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{x.invoices}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.billed)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.collected)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.credited)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.outstanding)}</TableCell>
              <TableCell className="text-end text-sm font-medium tabular-nums">
                {x.rate} %
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (report === "registrations") {
    const r = rows as RegistrationRow[];
    body = (
      <>
        <CardContent className="pt-5">
          <BarChart
            label={t("names.registrations")}
            format={(n) => String(n)}
            data={r.map((x) => ({ label: monthLabel(x.month), value: Number(x.registered) }))}
          />
        </CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead className="text-end">{t("submitted")}</TableHead>
              <TableHead className="text-end">{t("registered")}</TableHead>
              <TableHead className="text-end">{t("rejected")}</TableHead>
              <TableHead className="text-end">{t("medianDays")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.map((x) => (
              <TableRow key={x.month}>
                <TableCell className="font-mono text-sm">{x.month}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.submitted}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.registered}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.rejected}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {x.median_days ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  } else {
    const r = rows as CashierRow[];
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("cashier")}</TableHead>
            <TableHead className="text-end">{t("shifts")}</TableHead>
            <TableHead className="text-end">{t("payments")}</TableHead>
            <TableHead className="text-end">{t("amount")}</TableHead>
            <TableHead className="text-end">{t("difference")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.map((x) => (
            <TableRow key={x.cashier_id}>
              <TableCell className="text-sm">{x.cashier_name}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{x.shifts}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{x.payments}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.amount)}</TableCell>
              <TableCell
                className={`text-end text-sm tabular-nums ${Number(x.difference) !== 0 ? "text-status-rejected" : ""}`}
              >
                {usd(x.difference)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <ReportPicker
          label={t("report")}
          current={report}
          groups={REPORT_GROUPS.map((g) => ({
            label: t(`groups.${g.key}`),
            reports: g.reports.map((r) => ({
              value: r,
              label: t(`names.${r}`),
              href: reportHref(r),
            })),
          }))}
        />
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-3">
          <form className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="r" value={report} />
            {usesRange && (
              <>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("from")}</span>
                  <Input type="date" name="from" defaultValue={from} className="w-40" />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("to")}</span>
                  <Input type="date" name="to" defaultValue={to} className="w-40" />
                </label>
              </>
            )}
            {usesArea && (
              <AreaFilter
                key={`${district}/${section}/${sector}/${nbhd}`}
                districts={districts}
                sections={places.sections}
                sectors={places.sectors}
                neighbourhoods={places.neighbourhoods}
                initial={{ district, section, sector, nbhd }}
              />
            )}
            {usesDistrict && !usesArea && districts.length > 1 && (
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">{t("district")}</span>
                <NativeSelect name="district" defaultValue={district} className="w-auto min-w-44">
                  <option value="">{t("allDistricts")}</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {lang === "so" ? d.name_so : d.name_en}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {usesPos && desks.length > 0 && (
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">{t("pos")}</span>
                <NativeSelect name="pos" defaultValue={pos || "all"} className="w-auto min-w-44">
                  {!locked && <option value="all">{t("allPos")}</option>}
                  {desks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {isRevenue && (
              <>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("checkStatusLabel")}</span>
                  <NativeSelect
                    name="check"
                    defaultValue={checkSt ?? ""}
                    className="w-auto min-w-40"
                  >
                    <option value="">{t("allStatuses")}</option>
                    {CHECK_STATUSES.map((k) => (
                      <option key={k} value={k}>
                        {t(`checkStatus.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("billStatusLabel")}</span>
                  <NativeSelect name="bill" defaultValue={billSt ?? ""} className="w-auto min-w-40">
                    <option value="">{t("allStatuses")}</option>
                    {BILL_STATUSES.map((k) => (
                      <option key={k} value={k}>
                        {t(`billStatus.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("viewLabel")}</span>
                  <NativeSelect name="view" defaultValue={view} className="w-auto min-w-36">
                    {REVENUE_VIEWS.map((k) => (
                      <option key={k} value={k}>
                        {t(`views.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </>
            )}
            {report === "collections" && (
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">{t("groupBy")}</span>
                <NativeSelect name="by" defaultValue={by} className="w-auto min-w-36">
                  {COLLECTION_BY.map((b) => (
                    <option key={b} value={b}>
                      {t(`by.${b}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {BASIS_REPORTS.includes(report) && (
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">{t("basisLabel")}</span>
                <NativeSelect name="basis" defaultValue={basis} className="w-auto min-w-44">
                  {COLLECTION_BASIS.map((b) => (
                    <option key={b} value={b}>
                      {t(`basis.${b}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {report === "payments" && (
              <>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("method")}</span>
                  <NativeSelect
                    name="method"
                    defaultValue={method ?? ""}
                    className="w-auto min-w-44"
                  >
                    <option value="">{t("allMethods")}</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`methods.${m}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground text-xs">{t("feeType")}</span>
                  <NativeSelect name="fee" defaultValue={fee ?? ""} className="w-auto min-w-44">
                    <option value="">{t("allFeeTypes")}</option>
                    {feeTypes.map((f) => (
                      <option key={f.code} value={f.code}>
                        {lang === "so" ? f.name_so : f.name_en}
                      </option>
                    ))}
                    <option value="credit">{t("unallocated")}</option>
                  </NativeSelect>
                </label>
              </>
            )}
            {report === "parcels" && (
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">{t("kind")}</span>
                <NativeSelect name="kind" defaultValue={kind} className="w-auto min-w-44">
                  {PARCEL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <Button type="submit" size="sm" variant="outline">
              {t("apply")}
            </Button>
            {viewer.can("reports.export") && rows.length > 0 && (
              <div className="ms-auto flex flex-wrap gap-1">
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/exports/reports/${report}?format=pdf&${qs}`}>
                    <FileText aria-hidden />
                    {t("pdf")}
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/exports/reports/${report}?format=xlsx&${qs}`}>
                    <FileSpreadsheet aria-hidden />
                    {t("xlsx")}
                  </a>
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/api/exports/reports/${report}?format=csv&${qs}`}>
                    <Download aria-hidden />
                    {t("csv")}
                  </a>
                </Button>
              </div>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("related")}</span>
            {RELATED_REPORTS[report].map((r) => (
              <Link
                key={r}
                href={reportHref(r)}
                className="hover:bg-muted rounded-full border px-2.5 py-0.5"
              >
                {t(`names.${r}`)}
              </Link>
            ))}
          </div>
          {status && (
            <Card>
              <CardContent className="grid gap-4 pt-5 lg:grid-cols-[1fr_1.2fr]">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t("verificationTitle")}</p>
                  <ul className="grid grid-cols-2 gap-2">
                    {(["reconciled", "verified", "pending", "disputed"] as const).map((k) => (
                      <li key={k} className="rounded-md border px-3 py-2">
                        <span className="text-muted-foreground block text-xs">
                          {tc(`status.${k}`)}
                        </span>
                        <span className="font-medium tabular-nums">{usd(status[k].amount)}</span>{" "}
                        <span className="text-muted-foreground text-xs">· {status[k].n}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {t("approvalsLine", { approved: status.approved, waiting: status.waiting })}
                    {status.approvers
                      ? ` · ${t("approvedByLine", { names: status.approvers })}`
                      : ""}
                  </p>
                </div>
                {compare && (
                  <div className="text-sm">
                    <p className="mb-2 font-medium">
                      {t("compareTitle", {
                        from: compare[0]!.previous_from,
                        to: compare[0]!.previous_to,
                      })}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead />
                          <TableHead className="text-end">{t("thisPeriod")}</TableHead>
                          <TableHead className="text-end">{t("previousPeriod")}</TableHead>
                          <TableHead className="text-end">{t("change")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          ...compare.filter((c) => c.current_amount || c.previous_amount),
                          {
                            channel: "total",
                            current_amount: compare.reduce((s, c) => s + c.current_amount, 0),
                            previous_amount: compare.reduce((s, c) => s + c.previous_amount, 0),
                          },
                        ].map((c) => {
                          const change = c.previous_amount
                            ? ((c.current_amount - c.previous_amount) / c.previous_amount) * 100
                            : null;
                          return (
                            <TableRow
                              key={c.channel}
                              className={c.channel === "total" ? "font-medium" : ""}
                            >
                              <TableCell>
                                {c.channel === "total"
                                  ? t("grandTotal")
                                  : tc(`channels.${c.channel}`)}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {usd(c.current_amount)}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {usd(c.previous_amount)}
                              </TableCell>
                              <TableCell
                                className={`text-end tabular-nums ${change === null ? "" : change < 0 ? "text-status-rejected" : "text-status-approved"}`}
                              >
                                {change === null
                                  ? "—"
                                  : `${change > 0 ? "+" : ""}${format.number(change, { maximumFractionDigits: 1 })} %`}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card className="overflow-hidden">{body}</Card>
          <p className="text-muted-foreground text-xs">{t(`notes.${report}`)}</p>
        </div>
        {viewer.can("reports.assistant") && <AssistantPanel />}
      </div>
    </>
  );
}
