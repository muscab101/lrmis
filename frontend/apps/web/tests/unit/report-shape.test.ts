import { describe, expect, it } from "vitest";
import { groupChoices, readShape, shapeTable } from "@/lib/report-shape";
import type { ReportTable } from "@/lib/server/report-table";

const table: ReportTable = {
  title: "Payments",
  columns: [
    { label: "Receipt", kind: "mono" },
    { label: "District", kind: "text" },
    { label: "Method", kind: "text" },
    { label: "Amount", kind: "money", sum: true },
  ],
  rows: [
    ["R-1", "Hodan", "cash", 10],
    ["R-2", "Kaaraan", "cash", 30],
    ["R-3", "Hodan", "evc", 5.5],
    ["R-4", null, "cash", 4],
  ],
  totals: ["Total", null, null, 49.5],
  links: [["/a", null, null, null], ["/b", null, null, null], ["/c", null, null, null], ["/d", null, null, null]],
};

describe("report sort and summary", () => {
  it("offers names to sum up by, not codes or numbers", () => {
    expect(groupChoices(table).map((c) => c.label)).toEqual(["District", "Method"]);
  });

  it("summary: one row per value with a count and the sums; totals stay", () => {
    const out = shapeTable(table, { group: 1, sort: 2, dir: "desc" }, "Rows");
    expect(out.columns.map((c) => c.label)).toEqual(["District", "Rows", "Amount"]);
    expect(out.rows).toEqual([["Kaaraan", 1, 30], ["Hodan", 2, 15.5], [null, 1, 4]]);
    expect(out.totals).toEqual(["Total", 4, 49.5]);
  });

  it("detailed: sorting keeps each row's link, empty cells last", () => {
    const out = shapeTable(table, { group: null, sort: 1, dir: "asc" }, "Rows");
    expect(out.rows.map((r) => r[0])).toEqual(["R-1", "R-3", "R-2", "R-4"]);
    expect(out.links.map((l) => l[0])).toEqual(["/a", "/c", "/b", "/d"]);
  });

  it("ignores options that don't fit", () => {
    expect(readShape({ sort: "x", group: "-1", dir: "up" })).toEqual({ group: null, sort: null, dir: "desc" });
    expect(shapeTable(table, { group: 0, sort: 99, dir: "asc" }, "Rows")).toBe(table);
  });
});
