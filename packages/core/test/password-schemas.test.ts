import { describe, expect, it } from "vitest";
import { generatePassword, isPasswordBreached, passwordProblems } from "../src/password";
import { codeFromDbMessage } from "../src/errors";
import { createUserSchema, phone, roleSchema } from "../src/schemas";

describe("password policy", () => {
  it("requires 10+ characters and some variety", () => {
    expect(passwordProblems("short1A")).toContain("too_short");
    expect(passwordProblems("aaaaaaaaaaaa")).toContain("too_simple");
    expect(passwordProblems("lowercaseonly")).toContain("too_simple");
    expect(passwordProblems("Banadir-2026!")).toEqual([]);
  });

  it("generates passwords that pass the policy", () => {
    for (let i = 0; i < 50; i++) expect(passwordProblems(generatePassword())).toEqual([]);
  });

  it("detects a breached password via the k-anonymity range API", async () => {
    // SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fake = (async () => new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\nABC:1")) as unknown as typeof fetch;
    expect(await isPasswordBreached("password", fake)).toBe(true);
    expect(await isPasswordBreached("not-in-list-xyz", fake)).toBe(false);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await isPasswordBreached("x", down)).toBeNull();
  });
});

describe("schemas", () => {
  it("normalises phone numbers", () => {
    expect(phone.parse("+252 61 123 4567")).toBe("+252611234567");
    expect(phone.safeParse("0611234567").success).toBe(false);
  });

  it("validates the create-user form", () => {
    const ok = createUserSchema.safeParse({
      fullName: "Test Collector",
      email: "Collector.Test@Gmail.com",
      phone: "",
      roleIds: ["7f9c2ba4-e88f-4d5b-9b42-2b3a5f2d7c11"],
      districts: { mode: "selected", districtIds: ["5b1b6f0e-2a5c-4b8e-9d3f-1c2b3a4d5e6f"] },
      credentials: { mode: "password", password: "Banadir-2026!" },
      idempotencyKey: "0d3b2c1a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.email).toBe("collector.test@gmail.com");
      expect(ok.data.phone).toBeNull();
    }
    const bad = createUserSchema.safeParse({ fullName: "", email: "x", roleIds: [], districts: { mode: "selected", districtIds: [] } });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown permissions in a role", () => {
    const res = roleSchema.safeParse({ nameSo: "Xx", nameEn: "Xx", colour: "#16A34A", dataScope: "own", permissions: ["root.everything"] });
    expect(res.success).toBe(false);
  });
});

describe("db error mapping", () => {
  it("reads the code prefix of RPC errors", () => {
    expect(codeFromDbMessage("ROLE_IN_USE: 3")).toBe("ROLE_IN_USE");
    expect(codeFromDbMessage("PRIVILEGE_ESCALATION: payments.refund")).toBe("PRIVILEGE_ESCALATION");
    expect(codeFromDbMessage('duplicate key value violates unique constraint "x"')).toBe("CONFLICT");
    expect(codeFromDbMessage("something else")).toBeNull();
  });
});
