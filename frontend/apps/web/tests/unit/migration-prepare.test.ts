import { describe, expect, it } from "vitest";
import { fieldValue, prepare, suggestColumns, suggestTable, toDate, toGlType, toNumber } from "../../lib/migration/prepare";

describe("suggestions", () => {
  it("guesses what an old table holds", () => {
    expect(suggestTable("tbl_account", ["acc_id", "acc_name"])).toBe("accounts");
    expect(suggestTable("tbl_journal", ["id", "jv_date"])).toBe("entries");
    expect(suggestTable("tbl_journal_detail", ["jv_id", "acc_id", "dr", "cr"])).toBe("lines");
    expect(suggestTable("tbl_user", ["id", "name"])).toBe("ignore");
  });
  it("matches columns by name and by known other names, each used once", () => {
    const m = suggestColumns("lines", ["jv_no", "acc_id", "dr", "cr", "branch"]);
    expect([m.entry_key!.col, m.account_key!.col, m.debit!.col, m.credit!.col, m.district!.col]).toEqual(["jv_no", "acc_id", "dr", "cr", "branch"]);
  });
});

describe("transforms", () => {
  it("dates in the asked format, refusing impossible ones", () => {
    expect(toDate("2024-03-05")).toBe("2024-03-05");
    expect(toDate("05/03/2024", "dmy")).toBe("2024-03-05");
    expect(toDate("03/05/2024", "mdy")).toBe("2024-03-05");
    expect(toDate("31/02/2024", "dmy")).toBeNull();
    expect(toDate("1709596800", "unix")).toBe("2024-03-05");
  });
  it("numbers with commas, brackets and currency signs", () => {
    expect(toNumber("1,250.50")).toBe(1250.5);
    expect(toNumber("(40)")).toBe(-40);
    expect(toNumber("$12")).toBe(12);
    expect(toNumber("abc")).toBeNull();
  });
  it("a currency change only when a factor is set; defaults for empty values", () => {
    expect(fieldValue({ a: "10" }, { col: "a", transform: "number", factor: 0.5 }).value).toBe(5);
    expect(fieldValue({ a: null }, { col: "a", transform: "trim", default: "HQ" }).value).toBe("HQ");
    expect(fieldValue({ a: "x" }, { col: "a", transform: "number" }).bad).toMatch(/not a number/);
  });
  it("old account types", () => {
    expect(["A", "liabilities", "Capital", "Revenue", "X", "?"].map(toGlType)).toEqual(["asset", "liability", "equity", "income", "expense", null]);
  });
});

describe("preparing the records", () => {
  const tables = {
    acc: [
      { id: 1, code: "1100", name: "Cash", t: "A" },
      { id: 2, code: "SUNDRY", name: "Sundry", t: "X" },
    ],
    lines: [
      { jv: "JV-1", d: "05/03/2024", acc: 2, dr: "40", cr: null, dist: "HODAN" },
      { jv: "JV-1", d: "05/03/2024", acc: 1, dr: null, cr: "40", dist: "HODAN" },
      { jv: "JV-2", d: "06/03/2024", acc: 2, dr: "10", cr: null, dist: null },
      { jv: "JV-2", d: "06/03/2024", acc: 9, dr: null, cr: "9", dist: null },
    ],
  };
  const base = {
    tables,
    tableMap: { acc: "accounts", lines: "lines" } as const,
    columnMap: {
      accounts: { key: { col: "id" }, code: { col: "code", transform: "trim" }, name: { col: "name" }, type: { col: "t" } },
      lines: {
        entry_key: { col: "jv" },
        account_key: { col: "acc" },
        date: { col: "d", transform: "date", format: "dmy" },
        debit: { col: "dr", transform: "number" },
        credit: { col: "cr", transform: "number" },
        district: { col: "dist", transform: "upper" },
      },
    } as const,
    ourAccounts: ["1100", "5100"],
  };

  it("maps old accounts, groups lines into entries and names every problem", () => {
    const p = prepare({ ...base, accountMap: {} });
    const acc = Object.fromEntries(p.items.filter((i) => i.entity === "account").map((i) => [i.source_key, i]));
    expect(acc["1"]!.status).toBe("ready");
    expect(acc["1"]!.data).toMatchObject({ code: "1100", create: false });
    expect(acc["2"]!.message).toMatch(/4-digit/);
    const entries = Object.fromEntries(p.items.filter((i) => i.entity === "entry").map((i) => [i.source_key, i]));
    expect(entries["JV-1"]!.message).toMatch(/no account here for 2/);
    expect(entries["JV-2"]!.message).toMatch(/not equal/);
    expect(p.districtKeys).toEqual([{ key: "HODAN", lines: 2 }]);
    expect(p.accountKeys.map((a) => a.key)).toEqual(["1", "2", "9"]);
  });

  it("with the old account mapped to a new code, the balanced entry is ready", () => {
    const p = prepare({ ...base, accountMap: { "2": { code: "6900", create: true, name_en: "Sundry", type: "expense" } } });
    const jv1 = p.items.find((i) => i.entity === "entry" && i.source_key === "JV-1")!;
    expect(jv1.status).toBe("ready");
    expect(jv1.data).toMatchObject({ date: "2024-03-05", lines: [{ account_key: "2", debit: 40 }, { account_key: "1", credit: 40 }] });
    expect(p.summary).toMatchObject({ entries: { ready: 1, error: 1 }, debit: 40, credit: 40 });
  });

  it("one amount column with a sign, or with a D/C column", () => {
    const p = prepare({
      tables: { l: [{ j: 1, a: "1100", amt: "25", s: "D" }, { j: 1, a: "5100", amt: "25", s: "C" }, { j: 2, a: "1100", amt: "-5" }, { j: 2, a: "5100", amt: "5" }] },
      tableMap: { l: "lines" },
      columnMap: { lines: { entry_key: { col: "j" }, account_key: { col: "a" }, amount: { col: "amt", transform: "number" }, side: { col: "s" }, date: { col: "j", default: "2024-01-01", transform: "none" } } },
      accountMap: {},
      ourAccounts: ["1100", "5100"],
    });
    const e = p.items.filter((i) => i.entity === "entry");
    expect(e.map((i) => (i.data.lines as { debit: number; credit: number }[]).map((l) => [l.debit, l.credit]))).toEqual([
      [
        [25, 0],
        [0, 25],
      ],
      [
        [0, 5],
        [5, 0],
      ],
    ]);
  });
});
