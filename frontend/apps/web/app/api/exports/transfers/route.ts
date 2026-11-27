import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { fullHouseNo } from "@/lib/house-no";
import { getViewer } from "@/lib/server/auth";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";
import { TRANSFER_STATES, type TransferHistoryFilters, transferHistory, type TransferState } from "@/lib/server/transfer-history";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** The ownership transfer history with the page's filters, as Excel or PDF (the user's own districts only). */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.can("transfers.view")) return new NextResponse(null, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const get = (k: string) => sp.get(k) ?? "";
  const format = get("format") === "pdf" ? "pdf" : "xlsx";
  const locale = viewer.profile.locale && (routing.locales as readonly string[]).includes(viewer.profile.locale) ? viewer.profile.locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "legal.history" });
  const tst = await getTranslations({ locale, namespace: "legal.states" });
  const tl = await getTranslations({ locale, namespace: "legal" });
  const filters: TransferHistoryFilters = {
    q: get("q").slice(0, 80) || undefined,
    district: UUID.test(get("district")) ? get("district") : undefined,
    neighbourhood: UUID.test(get("neighbourhood")) ? get("neighbourhood") : undefined,
    type: UUID.test(get("type")) ? get("type") : undefined,
    state: (TRANSFER_STATES as readonly string[]).includes(get("state")) || get("state") === "pending" ? (get("state") as TransferState | "pending") : undefined,
    from: DATE.test(get("from")) ? get("from") : undefined,
    to: DATE.test(get("to")) ? get("to") : undefined,
    size: 500,
  };
  const { rows, total } = await transferHistory(filters);
  const columns: ReportTable["columns"] = [
    { label: t("transferId"), kind: "mono" },
    { label: t("parcel"), kind: "mono" },
    { label: t("houseNo"), kind: "text" },
    { label: t("district"), kind: "text" },
    { label: t("neighbourhood"), kind: "text" },
    { label: t("previousOwner"), kind: "text" },
    { label: t("newOwner"), kind: "text" },
    { label: t("type"), kind: "text" },
    { label: t("date"), kind: "date" },
    { label: t("files"), kind: "int", sum: true },
    { label: t("status"), kind: "text" },
  ];
  const body = rows.map((r) => [
    r.number,
    r.pun ?? "",
    fullHouseNo(r.nb_code, r.house_no) ?? "",
    (locale === "so" ? r.district_so : r.district_en) ?? "",
    (locale === "so" ? r.nb_so : r.nb_en) ?? "",
    r.from_names ?? "",
    r.to_names ?? "",
    (locale === "so" ? r.type_so : r.type_en) ?? tl(`transferKinds.${r.kind}`),
    r.on_date.slice(0, 10),
    r.files,
    tst(r.state),
  ]);
  const table: ReportTable = {
    title: t("title"),
    columns,
    rows: body,
    totals: columns.map((c, i) => (c.sum ? body.reduce((s, r) => s + Number(r[i] ?? 0), 0) : i === 0 ? t("totalRow") : null)),
    links: [],
  };
  const lines = [
    `${t("found", { n: total })}${total > rows.length ? ` · ${t("firstRows", { n: rows.length })}` : ""}`,
    ...(filters.from || filters.to ? [`${filters.from ?? ""} – ${filters.to ?? ""}`] : []),
    ...(filters.state ? [filters.state === "pending" ? t("pending") : tst(filters.state)] : []),
  ];
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="ownership-transfers.${ext}"`,
    "cache-control": "no-store",
  });
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  }
  return new NextResponse(await reportPdf(table, { lines }), { headers: headers("application/pdf", "pdf") });
}
