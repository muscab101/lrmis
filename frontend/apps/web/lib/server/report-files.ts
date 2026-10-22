import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Cell, CellKind, ReportTable } from "./report-table";

/** Lines printed under the title: period, district, who and when. */
export interface ReportMeta {
  lines: string[];
}

const TZ = "Africa/Mogadishu";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
// sv-SE gives "2026-10-01 13:00".
const dateTime = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const numeric = (k: CellKind) => k === "money" || k === "int" || k === "num" || k === "pct";

/** The cell as text, the way it reads on paper. */
export function cellText(v: Cell, kind: CellKind): string {
  if (v === null || v === "") return "";
  switch (kind) {
    case "money":
      return money.format(Number(v));
    case "int":
    case "num":
      return plain.format(Number(v));
    case "pct":
      return `${plain.format(Number(v))} %`;
    case "datetime":
      return dateTime.format(new Date(String(v)));
    default:
      return String(v);
  }
}

/** Neutralise spreadsheet formulas in text cells (same rule as the CSV exports). */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export async function reportXlsx(table: ReportTable, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LRMIS";
  wb.created = new Date();
  const ws = wb.addWorksheet(table.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.addRow([table.title]).font = { bold: true, size: 14 };
  for (const line of meta.lines) ws.addRow([line]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(table.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F8" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
  });
  const headerRow = header.number;

  const value = (v: Cell, kind: CellKind): ExcelJS.CellValue => {
    if (v === null || v === "") return null;
    if (numeric(kind)) return kind === "pct" ? Number(v) / 100 : Number(v);
    if (kind === "date") return new Date(`${v}T00:00:00Z`);
    if (kind === "datetime") return cellText(v, kind);
    return safeText(String(v));
  };
  for (const r of table.rows) ws.addRow(r.map((v, i) => value(v, table.columns[i]!.kind)));
  if (table.totals) {
    const t = ws.addRow(table.totals.map((v, i) => (v === null ? null : i === 0 && !table.columns[0]!.sum ? String(v) : value(v, table.columns[i]!.kind))));
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF999999" } } }));
  }

  table.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.numFmt = c.kind === "money" ? '"$"#,##0.00' : c.kind === "pct" ? "0.0%" : c.kind === "int" ? "#,##0" : c.kind === "num" ? "#,##0.##" : c.kind === "date" ? "yyyy-mm-dd" : "@";
    const longest = Math.max(c.label.length, ...table.rows.slice(0, 500).map((r) => cellText(r[i] ?? null, c.kind).length));
    col.width = Math.min(Math.max(longest + 2, 8), 48);
  });
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  if (table.rows.length > 0) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: table.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportPdf(table: ReportTable, meta: ReportMeta): ArrayBuffer {
  const doc = new jsPDF({ orientation: table.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const margin = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(table.title, margin, margin + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  meta.lines.forEach((line, i) => doc.text(line, margin, margin + 24 + i * 12));
  doc.setTextColor(0);

  const align = (k: CellKind) => (numeric(k) ? "right" : "left");
  autoTable(doc, {
    startY: margin + 30 + meta.lines.length * 12,
    margin: { left: margin, right: margin, bottom: margin + 10 },
    head: [table.columns.map((c) => ({ content: c.label, styles: { halign: align(c.kind) } }))],
    body: table.rows.map((r) => r.map((v, i) => ({ content: cellText(v, table.columns[i]!.kind), styles: { halign: align(table.columns[i]!.kind) } }))),
    foot: table.totals
      ? [table.totals.map((v, i) => ({ content: v === null ? "" : i === 0 && !table.columns[0]!.sum ? String(v) : cellText(v, table.columns[i]!.kind), styles: { halign: align(table.columns[i]!.kind) } }))]
      : undefined,
    showFoot: "lastPage",
    theme: "grid",
    styles: { font: "helvetica", fontSize: table.columns.length > 8 ? 7.5 : 8.5, cellPadding: 4, overflow: "linebreak", lineColor: 220, lineWidth: 0.5 },
    headStyles: { fillColor: [15, 61, 110], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [239, 243, 248], textColor: 0, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  const pages = doc.getNumberOfPages();
  const { width, height } = doc.internal.pageSize;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("LRMIS · Banadir Regional Administration", margin, height - margin / 2);
    doc.text(`${p} / ${pages}`, width - margin, height - margin / 2, { align: "right" });
  }
  return doc.output("arraybuffer");
}
