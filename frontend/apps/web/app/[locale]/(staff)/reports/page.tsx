import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BarChart3, Download } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { AssistantPanel } from "@/components/reports/assistant-panel";
import { BarChart } from "@/components/reports/bar-chart";
import { GroupedBars } from "@/components/reports/charts";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import {
  accountTotals,
  REPORTS,
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
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "reports.view");
  const t = await getTranslations("reports");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const report = (REPORTS as readonly string[]).includes(sp.r ?? "") ? (sp.r as ReportName) : "revenue";
  const { from, to } = reportRange(sp);
  const districts = await listDistricts();
  const district = districts.some((d) => d.id === sp.district) ? sp.district! : "";
  const rows = await runReport(report, { from, to, district: district || null });
  const usd = (n: number | string) => format.number(Number(n), { style: "currency", currency: "USD" });
  const usd0 = (n: number) => format.number(n, { style: "currency", currency: "USD", notation: "compact" });
  const name = (r: { district_so: string; district_en: string }) => (lang === "so" ? r.district_so : r.district_en);
  const qs = new URLSearchParams({ r: report, from, to, ...(district ? { district } : {}) }).toString();
  const usesRange = report !== "arrears";
  const usesDistrict = report === "revenue" || report === "income" || report === "arrears" || report === "registrations";
  const monthLabel = (m: string) => format.dateTime(new Date(`${m}-01T00:00:00`), { month: "short", year: "2-digit" });

  let body: React.ReactNode;
  if (rows.length === 0) body = <EmptyState icon={<BarChart3 />} title={t("empty")} description={t("emptyBody")} />;
  else if (report === "revenue") {
    const r = rows as RevenueRow[];
    const months = [...new Set(r.map((x) => x.month))];
    body = (
      <>
        <CardContent className="pt-5">
          <BarChart label={t("names.revenue")} format={usd0} data={months.map((m) => ({ label: monthLabel(m), value: r.filter((x) => x.month === m).reduce((s, x) => s + Number(x.amount), 0) }))} />
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
                <TableCell className="text-sm">{lang === "so" ? x.fee_name_so : x.fee_name_en}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.payments}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{usd(x.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                {t("total")}
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums">{usd(r.reduce((s, x) => s + Number(x.amount), 0))}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  } else if (report === "income") {
    const r = rows as IncomeRow[];
    const accounts = (await accountTotals(from, to)).filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
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
                { label: t("cashIn"), values: r.map((x) => Number(x.cash_in)), color: "var(--color-status-approved)" },
                { label: t("cashOut"), values: r.map((x) => Number(x.cash_out)), color: "var(--color-status-rejected)" },
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
                { label: t("expensesLabel"), values: r.map((x) => Number(x.expenses)), color: "var(--color-status-pending)" },
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
                <TableCell className="text-end text-sm font-medium tabular-nums">{usd(x.net)}</TableCell>
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
                    <TableCell className="text-end text-sm font-medium tabular-nums">{usd(a.net)}</TableCell>
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
          <BarChart label={t("names.arrears")} format={usd0} data={cols.slice(0, 5).map((c) => ({ label: t(`buckets.${c}`), value: r.reduce((s, x) => s + Number(x[c]), 0) }))} />
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
                <TableCell className="text-sm">{name(x)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{x.invoices}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c} className={`text-end text-sm tabular-nums ${c === "total" ? "font-medium" : ""}`}>
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
              <TableCell className="text-sm">{name(x)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{x.invoices}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.billed)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.collected)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.credited)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(x.outstanding)}</TableCell>
              <TableCell className="text-end text-sm font-medium tabular-nums">{x.rate} %</TableCell>
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
          <BarChart label={t("names.registrations")} format={(n) => String(n)} data={r.map((x) => ({ label: monthLabel(x.month), value: Number(x.registered) }))} />
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
                <TableCell className="text-end text-sm tabular-nums">{x.median_days ?? "—"}</TableCell>
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
              <TableCell className={`text-end text-sm tabular-nums ${Number(x.difference) !== 0 ? "text-status-rejected" : ""}`}>{usd(x.difference)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {REPORTS.map((r) => (
            <Link
              key={r}
              href={`/reports?r=${r}&from=${from}&to=${to}`}
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${report === r ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`names.${r}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-3">
          <form className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="r" value={report} />
            {usesRange && (
              <>
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{t("from")}</span>
                  <Input type="date" name="from" defaultValue={from} className="w-40" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{t("to")}</span>
                  <Input type="date" name="to" defaultValue={to} className="w-40" />
                </label>
              </>
            )}
            {usesDistrict && districts.length > 1 && (
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("district")}</span>
                <NativeSelect name="district" defaultValue={district} className="w-44">
                  <option value="">{t("allDistricts")}</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {lang === "so" ? d.name_so : d.name_en}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <Button type="submit" size="sm" variant="outline">
              {t("apply")}
            </Button>
            {viewer.can("reports.export") && rows.length > 0 && (
              <Button size="sm" variant="ghost" asChild className="ms-auto">
                <a href={`/api/exports/reports/${report}?${qs}`}>
                  <Download aria-hidden />
                  {t("csv")}
                </a>
              </Button>
            )}
          </form>
          <Card className="overflow-hidden">{body}</Card>
          <p className="text-xs text-muted-foreground">{t(`notes.${report}`)}</p>
        </div>
        <AssistantPanel />
      </div>
    </>
  );
}
