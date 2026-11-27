import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { fullHouseNo } from "@/lib/house-no";
import { getViewer } from "@/lib/server/auth";
import { invoicePage, invoicePageFilters } from "@/lib/server/billing";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";

/** The Invoices list with the page's filters and sorting, as Excel or PDF (the user's own districts only). */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.can("invoices.view") || !viewer.can("invoices.export")) return new NextResponse(null, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  const locale = viewer.profile.locale && (routing.locales as readonly string[]).includes(viewer.profile.locale) ? viewer.profile.locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "billing" });
  const tStatus = await getTranslations({ locale, namespace: "billing.invoiceStatus" });
  const f = invoicePageFilters(sp);
  const { rows, total, sums } = await invoicePage({ ...f, size: 2000 });
  const nm = (so: string | null, en: string | null) => (locale === "so" ? so : en) ?? "";
  const columns: ReportTable["columns"] = [
    { label: t("table.reference"), kind: "mono" },
    { label: t("year"), kind: "text" },
    { label: t("table.transactionDate"), kind: "date" },
    { label: t("table.dateDue"), kind: "date" },
    { label: t("table.pun"), kind: "mono" },
    { label: t("table.houseNo"), kind: "text" },
    { label: t("district"), kind: "text" },
    { label: t("table.owner"), kind: "text" },
    { label: t("table.telephone"), kind: "text" },
    { label: t("feeType"), kind: "text" },
    { label: t("statusLabel"), kind: "text" },
    { label: t("table.amount"), kind: "money", sum: true },
    { label: t("table.paid"), kind: "money", sum: true },
    { label: t("table.balance"), kind: "money", sum: true },
  ];
  const body = rows.map((i) => [
    i.number,
    i.period,
    i.issue_date,
    i.due_date,
    i.pun ?? i.account_no ?? "",
    fullHouseNo(i.nb_code, i.house_no) ?? "",
    nm(i.district_so, i.district_en),
    i.owners ?? "",
    i.phone ?? "",
    nm(i.fee_so, i.fee_en),
    tStatus.has(i.status) ? tStatus(i.status) : i.status,
    i.status === "cancelled" ? 0 : Number(i.total),
    i.status === "cancelled" ? 0 : Number(i.paid),
    i.status === "cancelled" ? 0 : Number(i.balance),
  ]);
  const table: ReportTable = {
    title: t("invoicesTitle"),
    columns,
    rows: body,
    totals: columns.map((c, n) => (n === 0 ? t("table.totalRow") : c.sum ? body.reduce((s, r) => s + Number(r[n] ?? 0), 0) : null)),
    links: [],
  };
  const lines = [
    `${t("sums.countN", { n: total })}${total > rows.length ? ` · ${t("table.firstRows", { n: rows.length })}` : ""}`,
    `${t("sums.billed")}: ${sums.billed.toFixed(2)} · ${t("sums.paid")}: ${sums.paid.toFixed(2)} · ${t("sums.outstanding")}: ${sums.outstanding.toFixed(2)} USD`,
    ...(f.from || f.to ? [`${f.from ?? ""} – ${f.to ?? ""}`] : []),
  ];
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="invoices.${ext}"`,
    "cache-control": "no-store",
  });
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  }
  return new NextResponse(await reportPdf(table, { lines }), { headers: headers("application/pdf", "pdf") });
}
