import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { getViewer } from "@/lib/server/auth";
import { cellText, reportPdf, reportXlsx } from "@/lib/server/report-files";
import { reportTable } from "@/lib/server/report-table";
import {
  AREA_REPORTS,
  BASIS_REPORTS,
  billStatus as parseBillStatus,
  checkStatus as parseCheckStatus,
  collectionBasis,
  revenueView,
  collectionBy,
  collectionsCompare,
  collectionsStatus,
  FINANCE_REPORTS,
  feeTypeCode,
  POS_REPORTS,
  parcelKind,
  paymentMethod,
  REPORTS,
  reportArea,
  reportRange,
  runReport,
  SNAPSHOT_REPORTS,
  type ReportName,
} from "@/lib/server/reports";
import { listDistricts } from "@/lib/server/users";
import { zonePlaces } from "@/lib/server/zones";
import { createClient } from "@/lib/supabase/server";
import { readShape, shapeTable } from "@/lib/report-shape";

async function posName(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase
    .from("points_of_sale")
    .select("code, name")
    .eq("id", id)
    .maybeSingle();
  return data ? `${data.code} · ${data.name}` : id;
}

async function feeTypeName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  code: string,
  locale: string,
) {
  const { data } = await supabase
    .from("fee_types")
    .select("name_so, name_en")
    .eq("code", code)
    .maybeSingle();
  return data ? (locale === "so" ? data.name_so : data.name_en) : null;
}

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
  if (!(REPORTS as readonly string[]).includes(name))
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const report = name as ReportName;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", { p_key: "reports.export" });
  if (!allowed) return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const { from, to } = reportRange(sp);
  const area = reportArea(sp);
  const district = area.district;
  const usesArea = AREA_REPORTS.includes(report);
  const kind = parcelKind(sp.kind);
  const method = report === "payments" ? paymentMethod(sp.method) : null;
  const fee = report === "payments" ? feeTypeCode(sp.fee) : null;
  const pos =
    POS_REPORTS.includes(report) && /^[0-9a-f-]{36}$/i.test(sp.pos ?? "") ? sp.pos! : null;
  const by = collectionBy(sp.by);
  const basis = collectionBasis(sp.basis);
  const isRevenue = report === "revenue";
  const checkSt = isRevenue ? parseCheckStatus(sp.check) : null;
  const billSt = isRevenue ? parseBillStatus(sp.bill) : null;
  const view = isRevenue ? revenueView(sp.view) : "summary";
  const format = sp.format === "pdf" || sp.format === "xlsx" ? sp.format : "csv";
  const locale = (routing.locales as readonly string[]).includes(sp.lang ?? "")
    ? sp.lang!
    : routing.defaultLocale;
  const place = usesArea
    ? { section: area.section, sector: area.sector, neighbourhood: area.neighbourhood }
    : {};
  const rows = (await runReport(
    report,
    {
      from,
      to,
      district,
      kind,
      method,
      feeType: fee,
      by,
      basis,
      pos,
      checkStatus: checkSt,
      billStatus: billSt,
      view,
      ...place,
    },
    supabase,
  )) as unknown[];
  const snapshot = SNAPSHOT_REPORTS.includes(report);
  const stamp = snapshot ? new Date().toISOString().slice(0, 10) : `${from}-${to}`;
  const file = `lrmis-${report}${report === "parcels" && kind !== "all" ? `-${kind}` : ""}${method ? `-${method}` : ""}${fee ? `-${fee}` : ""}${report === "collections" ? `-${by}` : ""}-${stamp}`;
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${file}.${ext}"`,
    "cache-control": "no-store",
  });

  if (format === "csv") {
    const raw = rows as Record<string, unknown>[];
    const cols = raw[0] ? Object.keys(raw[0]).filter((k) => !k.endsWith("_id")) : [];
    const body =
      "﻿" +
      [
        cols.map(csvCell).join(","),
        ...raw.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
      ].join("\r\n");
    return new NextResponse(body, { headers: headers("text/csv; charset=utf-8", "csv") });
  }

  const t = await getTranslations({ locale, namespace: "reports" });
  const [base, viewer, districts] = await Promise.all([
    reportTable(report, rows, locale),
    getViewer(),
    listDistricts(),
  ]);
  // The same view as the page: detailed or summed up by a column, sorted by any column.
  const q = request.nextUrl.searchParams;
  const table = shapeTable(base, readShape({ sort: q.get("sort"), dir: q.get("dir"), group: q.get("group") }), t("rowsLabel"));
  const d = districts.find((x) => x.id === district);
  const nm = (o: { name_so: string; name_en: string; code?: string }) =>
    `${o.code ? `${o.code} · ` : ""}${locale === "so" ? o.name_so : o.name_en}`;
  // Name the section, sector and neighbourhood the file is narrowed to.
  const places =
    usesArea && d && (area.section || area.sector || area.neighbourhood)
      ? await zonePlaces([d.id])
      : null;
  const found = places && {
    section: places.sections.find((x) => x.id === area.section),
    sector: places.sectors.find((x) => x.id === area.sector),
    neighbourhood: places.neighbourhoods.find((x) => x.id === area.neighbourhood),
  };
  const feeName = fee && fee !== "credit" ? await feeTypeName(supabase, fee, locale) : null;
  /** Collections reports: how money was counted, the verification and approval facts, and the previous period. */
  async function financeLines() {
    if (!FINANCE_REPORTS.includes(report)) return [];
    const tc = await getTranslations({ locale, namespace: "collections" });
    const money = (n: number) =>
      new Intl.NumberFormat(locale === "so" ? "so" : "en-US", {
        style: "currency",
        currency: "USD",
      }).format(n);
    const args = { from, to, district, basis, pos, ...place };
    const [st, cmp] = await Promise.all([
      collectionsStatus(args, supabase),
      BASIS_REPORTS.includes(report) ? collectionsCompare(args, supabase) : Promise.resolve(null),
    ]);
    const out: string[] = [];
    if (report === "collections") out.push(`${t("groupBy")}: ${t(`by.${by}`)}`);
    if (BASIS_REPORTS.includes(report)) out.push(`${t("basisLabel")}: ${t(`basis.${basis}`)}`);
    out.push(
      `${t("verificationTitle")}: ` +
        (["reconciled", "verified", "pending", "disputed"] as const)
          .map((k) => `${tc(`status.${k}`)} ${money(Number(st[k].amount))} (${st[k].n})`)
          .join(" · "),
    );
    out.push(
      t("approvalsLine", { approved: st.approved, waiting: st.waiting }) +
        (st.approvers ? ` · ${t("approvedByLine", { names: st.approvers })}` : ""),
    );
    if (cmp) {
      const now = cmp.reduce((a, c) => a + c.current_amount, 0);
      const before = cmp.reduce((a, c) => a + c.previous_amount, 0);
      const pct = before
        ? ` (${now >= before ? "+" : ""}${(((now - before) / before) * 100).toFixed(1)} %)`
        : "";
      out.push(
        `${t("compareTitle", { from: cmp[0]!.previous_from, to: cmp[0]!.previous_to })}: ${money(before)} → ${money(now)}${pct}`,
      );
      out.push(
        cmp
          .filter((c) => c.current_amount || c.previous_amount)
          .map(
            (c) =>
              `${tc(`channels.${c.channel}`)} ${money(c.previous_amount)} → ${money(c.current_amount)}`,
          )
          .join(" · "),
      );
    }
    return out;
  }
  const lines = [
    snapshot
      ? t("asOf", { date: new Date().toISOString().slice(0, 10) })
      : t("period", { from, to }),
    `${t("district")}: ${d ? nm({ name_so: d.name_so, name_en: d.name_en }) : t("allDistricts")}`,
    ...(found?.section ? [`${t("section")}: ${nm(found.section)}`] : []),
    ...(found?.sector ? [`${t("sector")}: ${nm(found.sector)}`] : []),
    ...(found?.neighbourhood ? [`${t("neighbourhood")}: ${nm(found.neighbourhood)}`] : []),
    ...(report === "parcels" ? [`${t("kind")}: ${t(`kinds.${kind}`)}`] : []),
    ...(method ? [`${t("method")}: ${t(`methods.${method}`)}`] : []),
    ...(pos ? [`${t("pos")}: ${await posName(supabase, pos)}`] : []),
    ...(fee ? [`${t("feeType")}: ${fee === "credit" ? t("unallocated") : (feeName ?? fee)}`] : []),
    ...(checkSt ? [`${t("checkStatusLabel")}: ${t(`checkStatus.${checkSt}`)}`] : []),
    ...(billSt ? [`${t("billStatusLabel")}: ${t(`billStatus.${billSt}`)}`] : []),
    ...(isRevenue ? [`${t("viewLabel")}: ${t(`views.${view}`)}`] : []),
    ...(await financeLines()),
    t("generated", {
      at: cellText(new Date().toISOString(), "datetime"),
      by: viewer?.profile.full_name ?? "",
    }),
    t("rowsCount", { count: table.rows.length }),
  ];
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
