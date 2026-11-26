import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { getViewer } from "@/lib/server/auth";
import {
  CAMPAIGN_STATES,
  type CampaignState,
  type CampaignSummary,
  campaignMessages,
  getCampaign,
  listCampaignHistory,
  MESSAGE_CATEGORIES,
  type MessageCategory,
} from "@/lib/server/messages";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Message reports as Excel or PDF: ?campaign=<id> gives one campaign's recipients and how each message went;
 * otherwise the message history with the page's filters. Runs on the user's own session, so they only get what they may see.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.can("messages.export")) return new NextResponse(null, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const locale =
    viewer.profile.locale && (routing.locales as readonly string[]).includes(viewer.profile.locale) ? viewer.profile.locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "messages" });
  const label = (c: CampaignSummary) =>
    c.kind === "compose" ? (c.title ?? t(`compose.categories.${c.category ?? "custom"}`)) : t(`templates.${c.template_code ?? "general_notice"}`);
  const audience = (c: CampaignSummary) =>
    c.areas && c.areas.length > 0
      ? c.areas.map((a) => `${t(`compose.levels.${a.level}`)} ${locale === "so" ? a.name_so : a.name_en}`).join(", ")
      : c.target?.all
        ? t("history.allOwners")
        : c.kind === "compose"
        ? t("history.chosenOwners", { n: c.target?.owners?.length ?? 0 })
        : c.district
          ? locale === "so"
            ? c.district.name_so
            : c.district.name_en
          : t("allDistricts");

  let table: ReportTable;
  let lines: string[];
  let file: string;
  const campaignId = sp.get("campaign");
  if (campaignId) {
    if (!UUID.test(campaignId)) return new NextResponse(null, { status: 404 });
    const c = await getCampaign(campaignId);
    if (!c) return new NextResponse(null, { status: 404 });
    // The server hands out at most 1000 rows at a time.
    const rows: Awaited<ReturnType<typeof campaignMessages>>["rows"] = [];
    for (let page = 1; page <= 10; page++) {
      const chunk = await campaignMessages(campaignId, "any", page, 1000);
      rows.push(...chunk.rows);
      if (rows.length >= chunk.total || chunk.rows.length === 0) break;
    }
    const columns: ReportTable["columns"] = [
      { label: t("history.owner"), kind: "text" },
      { label: t("to"), kind: "mono" },
      { label: t("statusLabel"), kind: "text" },
      { label: t("history.attempts"), kind: "int" },
      { label: t("history.sentAt"), kind: "datetime" },
      { label: t("history.error"), kind: "text" },
      { label: t("message"), kind: "text" },
    ];
    table = {
      title: `${t("history.detailTitle")} ${c.number}`,
      columns,
      rows: rows.map((m) => [m.party?.full_name ?? "", m.to_address, t(`status.${m.status}`), m.attempts, m.sent_at, m.last_error ?? "", m.body]),
      totals: null,
      links: [],
    };
    lines = [
      label(c),
      audience(c),
      `${t("history.recipients")}: ${c.total} · ${t("history.delivered")}: ${c.sent} · ${t("history.failed")}: ${c.failed} · ${t("history.waiting")}: ${c.waiting}`,
      `${t("history.sender")}: ${c.sender ?? "—"} · ${t(`history.states.${c.state}`)}`,
    ];
    file = `messages-${c.number}`;
  } else {
    const state = (CAMPAIGN_STATES as readonly string[]).includes(sp.get("state") ?? "") ? (sp.get("state") as CampaignState) : undefined;
    const category = (MESSAGE_CATEGORIES as readonly string[]).includes(sp.get("category") ?? "") ? (sp.get("category") as MessageCategory) : undefined;
    const from = DATE.test(sp.get("from") ?? "") ? sp.get("from")! : undefined;
    const to = DATE.test(sp.get("to") ?? "") ? sp.get("to")! : undefined;
    const q = (sp.get("q") ?? "").slice(0, 80) || undefined;
    const { rows } = await listCampaignHistory({ q, state, category, from, to, size: 200 });
    const columns: ReportTable["columns"] = [
      { label: t("history.number"), kind: "mono" },
      { label: t("history.created"), kind: "datetime" },
      { label: t("history.message"), kind: "text" },
      { label: t("compose.category"), kind: "text" },
      { label: t("history.to"), kind: "text" },
      { label: t("history.sender"), kind: "text" },
      { label: t("history.recipients"), kind: "int", sum: true },
      { label: t("history.delivered"), kind: "int", sum: true },
      { label: t("history.failed"), kind: "int", sum: true },
      { label: t("history.state"), kind: "text" },
    ];
    const body = rows.map((c) => [
      c.number,
      c.created_at,
      label(c),
      c.category ? t(`compose.categories.${c.category}`) : "",
      audience(c),
      c.sender ?? "",
      c.total || c.recipients,
      c.sent,
      c.failed,
      t(`history.states.${c.state}`),
    ]);
    table = {
      title: t("history.reportTitle"),
      columns,
      rows: body,
      totals: columns.map((col, i) => (col.sum ? body.reduce((s, r) => s + Number(r[i] ?? 0), 0) : i === 0 ? t("history.total") : null)),
      links: [],
    };
    lines = [
      `${rows.length} · ${from ?? ""}${from || to ? " – " : ""}${to ?? ""}`.trim(),
      ...(state ? [t(`history.states.${state}`)] : []),
      ...(category ? [t(`compose.categories.${category}`)] : []),
    ];
    file = "message-history";
  }

  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${file}.${ext}"`,
    "cache-control": "no-store",
  });
  if (format === "xlsx") {
    const buf = await reportXlsx(table, { lines });
    return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  }
  return new NextResponse(await reportPdf(table, { lines }), { headers: headers("application/pdf", "pdf") });
}
