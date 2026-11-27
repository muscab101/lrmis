import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { fullHouseNo } from "@/lib/house-no";
import { getViewer } from "@/lib/server/auth";
import { paymentFilters, queryPayments } from "@/lib/server/payments";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";

/** The Payments list with the page's filters, as Excel or PDF (the user's own districts only). */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.can("payments.view") || !viewer.can("payments.export")) return new NextResponse(null, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  const locale = viewer.profile.locale && (routing.locales as readonly string[]).includes(viewer.profile.locale) ? viewer.profile.locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "payments" });
  const filters = paymentFilters(sp);
  const { rows, total, sum } = await queryPayments({ ...filters, size: 1000 });
  const columns: ReportTable["columns"] = [
    { label: t("receipt"), kind: "mono" },
    { label: t("received"), kind: "datetime" },
    { label: t("pun"), kind: "mono" },
    { label: t("houseNo"), kind: "text" },
    { label: t("district"), kind: "text" },
    { label: t("payer"), kind: "text" },
    { label: t("method"), kind: "text" },
    { label: t("reference"), kind: "mono" },
    { label: t("takenAt"), kind: "text" },
    { label: t("takenBy"), kind: "text" },
    { label: t("statusLabel"), kind: "text" },
    { label: t("amount"), kind: "money", sum: true },
  ];
  const body = rows.map((p) => [
    p.receipt_no,
    p.received_at,
    p.pun ?? "",
    fullHouseNo(p.nb_code, p.house_no) ?? "",
    (locale === "so" ? p.district_so : p.district_en) ?? "",
    [p.payer_name, p.payer_phone].filter(Boolean).join(" · "),
    `${t(`methods.${p.method}`)}${p.wallet ? ` · ${t(`wallets.${p.wallet}`)}` : ""}`,
    p.reference ?? p.provider_ref ?? "",
    p.online ? t("channels.online") : (p.pos_code ?? t("channels.desk")),
    p.taken_by ?? "",
    t(`status.${p.status}`),
    p.status === "reversed" ? 0 : Number(p.amount_base),
  ]);
  const table: ReportTable = {
    title: t("title"),
    columns,
    rows: body,
    totals: columns.map((c, i) => (c.sum ? sum : i === 0 ? t("totalRow") : null)),
    links: [],
  };
  const lines = [
    `${t("found", { n: total })}${total > rows.length ? ` · ${t("firstRows", { n: rows.length })}` : ""}`,
    ...(filters.from || filters.to ? [`${filters.from ?? ""} – ${filters.to ?? ""}`] : []),
  ];
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="payments.${ext}"`,
    "cache-control": "no-store",
  });
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  }
  return new NextResponse(await reportPdf(table, { lines }), { headers: headers("application/pdf", "pdf") });
}
