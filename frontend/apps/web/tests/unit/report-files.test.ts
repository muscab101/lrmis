import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { code128 } from "@/lib/server/barcode";
import { reportPdf, reportXlsx } from "@/lib/server/report-files";
import type { ReportTable } from "@/lib/server/report-table";

const table: ReportTable = {
  title: "Revenue",
  columns: [
    { label: "Month", kind: "text" },
    { label: "Paid for", kind: "text" },
    { label: "Payments", kind: "int", sum: true },
    { label: "Amount", kind: "money", sum: true },
  ],
  rows: [
    ["2026-10", "Unallocated credit", 1, 25],
    ["2026-10", "Tax bill", 3, 95.4],
    ["2026-10", "Service charge", 2, 24],
  ],
  totals: ["Total", null, 6, 144.4],
  links: [],
};
const meta = {
  lines: [
    "Period: 2026-01-01 to 2026-10-27",
    "District: All districts",
    "Generated 2026-10-27 17:07 by musab",
    "3 rows",
  ],
};

describe("report files", () => {
  it("encodes Code 128: start + characters + check symbol at 11 modules each, then the 13-module stop", () => {
    const text = "RPT-20261027-1707-AB12";
    const widths = code128(text);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(11 * (text.length + 2) + 13);
    expect(widths.length % 2).toBe(1); // starts and ends with a bar
    expect(() => code128("é")).toThrow();
  });

  it("builds the PDF with the emblem, barcode and numbered rows", async () => {
    const pdf = Buffer.from(await reportPdf(table, meta));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.SAMPLE_PDF) writeFileSync(process.env.SAMPLE_PDF, pdf);
  });

  it("numbers the rows in Excel too", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await reportXlsx(table, meta)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const header = ws.getRow(meta.lines.length + 3);
    expect(header.getCell(1).value).toBe("#");
    expect(header.getCell(2).value).toBe("Month");
    expect(ws.getRow(meta.lines.length + 4).getCell(1).value).toBe(1);
    expect(ws.getRow(meta.lines.length + 6).getCell(1).value).toBe(3);
  });
});
