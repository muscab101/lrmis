import { describe, expect, it } from "vitest";
import { splitSharedM2 } from "../../lib/land-units";

describe("splitting a compound's shared m²", () => {
  it("equally", () => expect(splitSharedM2([200, 150], 650, "equal")).toEqual([325, 325]));
  it("by house size", () =>
    expect(splitSharedM2([200, 150], 650, "by_size")).toEqual([371.43, 278.57]));
  it("the rounding never loses any", () => {
    const parts = splitSharedM2([100, 100, 100], 100, "equal");
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(parts.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
  });
});
