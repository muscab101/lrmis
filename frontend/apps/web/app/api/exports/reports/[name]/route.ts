import { NextResponse, type NextRequest } from "next/server";
import { REPORTS, reportRange, runReport, type ReportName } from "@/lib/server/reports";
import { createClient } from "@/lib/supabase/server";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of one report with the page's filters. The report functions check access themselves. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(REPORTS as readonly string[]).includes(name)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", { p_key: "reports.export" });
  if (!allowed) return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const { from, to } = reportRange(sp);
  const district = /^[0-9a-f-]{36}$/i.test(sp.district ?? "") ? sp.district! : null;
  const rows = (await runReport(name as ReportName, { from, to, district }, supabase)) as unknown as Record<string, unknown>[];
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => !k.endsWith("_id")) : [];
  const body = "﻿" + [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lrmis-${name}-${from}-${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
