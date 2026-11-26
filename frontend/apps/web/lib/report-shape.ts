import type { Cell, Column, ReportTable } from "@/lib/server/report-table";

/** How a report is shown: its detail rows, or summed up by one of its columns; and which column sorts it. */
export interface ReportShape {
  /** Column of the original table to sum up by (the summary view); null shows every row (the detailed view). */
  group: number | null;
  /** Column of the table as shown to sort by; null keeps the report's own order. */
  sort: number | null;
  dir: "asc" | "desc";
}

/** Read sort / dir / group from the page's or the file's address. */
export function readShape(p: { sort?: string | null; dir?: string | null; group?: string | null }): ReportShape {
  const int = (v?: string | null) => (v != null && /^\d{1,2}$/.test(v) ? Number(v) : null);
  return { group: int(p.group), sort: int(p.sort), dir: p.dir === "asc" ? "asc" : "desc" };
}

/** Columns a report can be summed up by: names and dates (not numbers, not ID-like codes), when it has sums to show. */
export function groupChoices(table: ReportTable): { index: number; label: string }[] {
  if (!table.columns.some((c) => c.sum)) return [];
  return table.columns
    .map((c, index) => ({ index, label: c.label, kind: c.kind, sum: c.sum }))
    .filter((c) => !c.sum && (c.kind === "text" || c.kind === "date"))
    .filter((c) => {
      // Worth offering only when it really groups: more than one value, fewer values than rows.
      const seen = new Set(table.rows.map((r) => r[c.index]));
      return seen.size > 1 && seen.size < table.rows.length;
    })
    .map(({ index, label }) => ({ index, label }));
}

const empty = (v: Cell) => v === null || v === "";
const compare = (a: Cell, b: Cell) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

/**
 * The table as asked for: summed up by a column (one row per value, a count, and each summed column added up), then
 * sorted. The page, the PDF and the Excel file all pass through here, so they always show the same thing.
 */
export function shapeTable(table: ReportTable, shape: ReportShape, countLabel: string): ReportTable {
  let out = table;
  const g = shape.group;
  if (g !== null && groupChoices(table).some((c) => c.index === g)) {
    const sums = table.columns.map((c, i) => (c.sum ? i : -1)).filter((i) => i >= 0);
    const by = new Map<Cell, { count: number; sums: number[] }>();
    for (const r of table.rows) {
      const key = r[g] ?? null;
      const cur = by.get(key) ?? { count: 0, sums: sums.map(() => 0) };
      cur.count++;
      sums.forEach((i, k) => (cur.sums[k]! += Number(r[i] ?? 0) || 0));
      by.set(key, cur);
    }
    const columns: Column[] = [table.columns[g]!, { label: countLabel, kind: "int", sum: true }, ...sums.map((i) => table.columns[i]!)];
    const rows: Cell[][] = [...by.entries()].map(([key, v]) => [key, v.count, ...v.sums.map((x) => Math.round(x * 100) / 100)]);
    // The totals row keeps the report's own totals (and its "Total" label, when it has one).
    const totals: Cell[] = [
      typeof table.totals?.[0] === "string" ? table.totals[0] : null,
      table.rows.length,
      ...sums.map((i, k) => table.totals?.[i] ?? Math.round(rows.reduce((t, r) => t + Number(r[k + 2] ?? 0), 0) * 100) / 100),
    ];
    out = { title: table.title, columns, rows, totals, links: [] };
  }
  const s = shape.sort;
  if (s !== null && s < out.columns.length) {
    const sign = shape.dir === "asc" ? 1 : -1;
    const order = out.rows
      .map((_, i) => i)
      .sort((a, b) => {
        const x = out.rows[a]![s] ?? null;
        const y = out.rows[b]![s] ?? null;
        // Empty cells stay at the bottom either way.
        if (empty(x) || empty(y)) return empty(x) === empty(y) ? a - b : empty(x) ? 1 : -1;
        return compare(x, y) * sign || a - b;
      });
    out = { ...out, rows: order.map((i) => out.rows[i]!), links: out.links.length ? order.map((i) => out.links[i] ?? []) : [] };
  }
  return out;
}
