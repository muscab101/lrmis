import { describe, expect, it } from "vitest";
import { normalizePun } from "@/lib/pun";

describe("normalizePun", () => {
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
