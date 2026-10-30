import { area } from "@turf/area";
import { describe, expect, it } from "vitest";
import { splitPolygon } from "@/lib/split-polygon";

// A tilted plot of about 12 m × 12 m in Mogadishu.
const plot: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[[45.3, 2.04], [45.30011, 2.040005], [45.300105, 2.040113], [45.299995, 2.040108], [45.3, 2.04]]],
};
const m2 = (g: GeoJSON.Polygon) => area({ type: "Feature", geometry: g, properties: {} });

describe("splitPolygon", () => {
  it.each(["across", "along"] as const)("cuts %s into the sizes asked for, covering the plot", (dir) => {
    const total = m2(plot);
    const parts = splitPolygon(plot, [40, 30, total - 70], dir);
    expect(parts).toHaveLength(3);
    expect(m2(parts[0]!)).toBeCloseTo(40, 0);
    expect(m2(parts[1]!)).toBeCloseTo(30, 0);
    expect(parts.reduce((s, p) => s + m2(p), 0)).toBeCloseTo(total, 0);
    for (const p of parts) expect(p.coordinates[0]![0]).toEqual(p.coordinates[0]!.at(-1));
  });
});
