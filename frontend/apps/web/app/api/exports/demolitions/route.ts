import { getTranslations } from "next-intl/server";
import { fullHouseNo } from "@/lib/house-no";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { getViewer } from "@/lib/server/auth";
import { listDemolitions, type DemolitionFilters } from "@/lib/server/demolitions";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";

/** The archive as shown, with its filters, as Excel or PDF. */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.can("parcels.demolitions")) return new NextResponse(null, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const get = (k: string) => sp.get(k) ?? undefined;
  const tab = (
    ["archive", "pending", "closed"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "archive"
  ) as DemolitionFilters["tab"];
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const locale =
    viewer.profile.locale && (routing.locales as readonly string[]).includes(viewer.profile.locale)
      ? viewer.profile.locale
      : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "demolitions" });
  const rows = await listDemolitions(
    {
      tab,
      d: get("d"),
      s: get("s"),
      k: get("k"),
      n: get("n"),
      from: get("from"),
      to: get("to"),
      q: get("q"),
    },
    5000,
  );
  const name = (o: { name_so: string; name_en: string } | null | undefined) =>
    o ? (locale === "so" ? o.name_so : o.name_en) : "";
  const columns: ReportTable["columns"] = [
    { label: t("colNumber"), kind: "mono" },
    { label: t("colPun"), kind: "mono" },
    { label: t("colHouse"), kind: "text" },
    { label: t("place_d"), kind: "text" },
    { label: t("place_s"), kind: "text" },
    { label: t("place_k"), kind: "text" },
    { label: t("place_n"), kind: "text" },
    { label: t("colOwners"), kind: "text" },
    { label: t("colDate"), kind: "date" },
    { label: t("reason"), kind: "text" },
    { label: t("colStatus"), kind: "text" },
    { label: t("colOwed"), kind: "money", sum: true },
  ];
  const body = rows.map((r) => [
    r.number,
    r.pun,
    fullHouseNo(r.snapshot.neighbourhood?.code, r.house_no),
    name(r.snapshot.district),
    r.snapshot.section?.code ?? "",
    r.snapshot.sector?.code ?? "",
    r.snapshot.neighbourhood?.code ?? "",
    r.owner_names,
    r.demolition_date,
    r.reason,
    r.rebuilt_at ? t("rebuilt") : t(`status_${r.status}`),
    r.outstanding,
  ]);
  const table: ReportTable = {
    title: t("title"),
    columns,
    rows: body,
    totals: columns.map((c, i) =>
      c.sum ? rows.reduce((s, r) => s + r.outstanding, 0) : i === 0 ? t("colTotal") : null,
    ),
    links: [],
  };
  const lines = [
    `${t(`tab_${tab}`)} · ${rows.length}`,
    ...(get("from") || get("to") ? [`${get("from") ?? ""} – ${get("to") ?? ""}`] : []),
  ];
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="demolished-properties.${ext}"`,
    "cache-control": "no-store",
  });
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), {
      headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    });
  }
  return new NextResponse(await reportPdf(table, { lines }), {
    headers: headers("application/pdf", "pdf"),
  });
}
