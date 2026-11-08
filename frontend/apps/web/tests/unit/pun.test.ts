import { describe, expect, it } from "vitest";
import { normalizePun } from "@/lib/pun";

describe("normalizePun", () => {
  it("reads the short PUN (2026-11-07) and a flat's own number", () => {
    expect(normalizePun(" 3441712 ")).toBe("3441712");
    expect(normalizePun("3441718-1")).toBe("3441718-1");
    expect(normalizePun("21111-2")).toBe("21111-2");
    expect(normalizePun("3441113a")).toBe("3441113A");
  });

  it("drops the old BN, dashes and case", () => {
    expect(normalizePun(" bn34krwjxl0107 ")).toBe("34KRWJXL0107");
    expect(normalizePun("BN-HDN-012-01")).toBe("HDN01201");
    expect(normalizePun("34KRWJXL0107A")).toBe("34KRWJXL0107A");
  });

  it("keeps the dash of a flat or compound house", () => {
    expect(normalizePun(" 34krwjxl0116-02 ")).toBe("34KRWJXL0116-02");
    expect(normalizePun("34KRBMNG0115-a")).toBe("34KRBMNG0115-A");
    expect(normalizePun("BN34KRWJXL0116-02")).toBe("34KRWJXL0116-02");
  });

  it("still ignores dashes typed inside a land's own PUN", () => {
    expect(normalizePun("34-KRWJXL-0116")).toBe("34KRWJXL0116");
    expect(normalizePun("HDN-01201")).toBe("HDN01201");
  });
});
