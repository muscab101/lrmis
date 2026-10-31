import { describe, expect, it } from "vitest";
import { normalizePun } from "@/lib/pun";

describe("normalizePun", () => {
  it("drops the old BN, dashes and case", () => {
    expect(normalizePun(" bn34krwjxl0107 ")).toBe("34KRWJXL0107");
    expect(normalizePun("BN-HDN-012-01")).toBe("HDN01201");
    expect(normalizePun("34KRWJXL0107A")).toBe("34KRWJXL0107A");
  });
});
