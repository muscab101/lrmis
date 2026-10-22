import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { getViewer } from "@/lib/server/auth";
import { cellText, reportPdf, reportXlsx } from "@/lib/server/report-files";
import { reportTable } from "@/lib/server/report-table";
import { parcelKind, REPORTS, reportRange, runReport, SNAPSHOT_REPORTS, type ReportName } from "@/lib/server/reports";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One report as PDF (?format=pdf), Excel (?format=xlsx) or CSV (default), with the page's filters.
 * Runs on the user's own session: the report functions check access and district scope themselves.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(REPORTS as readonly string[]).includes(name)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const report = name as ReportName;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", { p_key: "reports.export" });
  if (!allowed) return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const { from, to } = reportRange(sp);
  const district = /^[0-9a-f-]{36}$/i.test(sp.district ?? "") ? sp.district! : null;
  const kind = parcelKind(sp.kind);
  const format = sp.format === "pdf" || sp.format === "xlsx" ? sp.format : "csv";
  const locale = (routing.locales as readonly string[]).includes(sp.lang ?? "") ? sp.lang! : routing.defaultLocale;
  const rows = (await runReport(report, { from, to, district, kind }, supabase)) as unknown[];
  const snapshot = SNAPSHOT_REPORTS.includes(report);
  const stamp = snapshot ? new Date().toISOString().slice(0, 10) : `${from}-${to}`;
  const file = `lrmis-${report}${report === "parcels" && kind !== "all" ? `-${kind}` : ""}-${stamp}`;
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${file}.${ext}"`,
    "cache-control": "no-store",
  });

  if (format === "csv") {
    const raw = rows as Record<string, unknown>[];
    const cols = raw[0] ? Object.keys(raw[0]).filter((k) => !k.endsWith("_id")) : [];
    const body = "﻿" + [cols.map(csvCell).join(","), ...raw.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
    return new NextResponse(body, { headers: headers("text/csv; charset=utf-8", "csv") });
  }

  const t = await getTranslations({ locale, namespace: "reports" });
  const [table, viewer, districts] = await Promise.all([reportTable(report, rows, locale), getViewer(), listDistricts()]);
  const d = districts.find((x) => x.id === district);
  const lines = [
    snapshot ? t("asOf", { date: new Date().toISOString().slice(0, 10) }) : t("period", { from, to }),
    `${t("district")}: ${d ? (locale === "so" ? d.name_so : d.name_en) : t("allDistricts")}`,
    ...(report === "parcels" ? [`${t("kind")}: ${t(`kinds.${kind}`)}`] : []),
    t("generated", { at: cellText(new Date().toISOString(), "datetime"), by: viewer?.profile.full_name ?? "" }),
    t("rowsCount", { count: table.rows.length }),
  ];
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  }
  return new NextResponse(reportPdf(table, { lines }), { headers: headers("application/pdf", "pdf") });
}
