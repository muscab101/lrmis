import { describe, expect, it } from "vitest";
import { effectivePermissions, ungrantablePermissions, widestScope } from "../src/permissions";

describe("effective permissions", () => {
  it("is the union of all roles", () => {
    const perms = effectivePermissions([
      { grantsAll: false, permissions: ["parcels.view"], dataScope: "district" },
      { grantsAll: false, permissions: ["payments.create", "not.a_permission"], dataScope: "own" },
    ]);
    expect([...perms].sort()).toEqual(["parcels.view", "payments.create"]);
  });

  it("gives everything to a grants-all role", () => {
    expect(effectivePermissions([{ grantsAll: true, permissions: [], dataScope: "all" }]).size).toBe(213);
  });

  it("uses the widest data scope", () => {
    expect(widestScope(["own", "district"])).toBe("district");
    expect(widestScope(["districts", "all", "own"])).toBe("all");
    expect(widestScope([])).toBe("own");
  });

  it("lists permissions an actor cannot grant", () => {
    expect(ungrantablePermissions(new Set(["users.view"]), ["users.view", "payments.refund"])).toEqual([
      "payments.refund",
    ]);
  });
});
