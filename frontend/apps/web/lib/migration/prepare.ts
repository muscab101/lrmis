/**
 * Turning old rows into our records for the accounting migration: table and column suggestions, the transforms a
 * column can go through, and the records (accounts, journal entries with their lines) with every problem named.
 * Pure functions: the same input always gives the same preview.
 */
import type { Cell, Row } from "./source";

export type Entity = "accounts" | "entries" | "lines";
export type TableTarget = Entity | "ignore";
export type Transform = "none" | "trim" | "upper" | "lower" | "number" | "date";
export type DateFormat = "auto" | "ymd" | "dmy" | "mdy" | "unix";
export type GlType = "asset" | "liability" | "equity" | "income" | "expense";

export interface FieldMap {
  col: string | null;
  transform?: Transform;
  format?: DateFormat;
  /** Used when the old value is empty. */
  default?: string;
  /** Money only, and only when set: multiply (a currency change). */
  factor?: number;
}
export type ColumnMap = Partial<Record<Entity, Record<string, FieldMap>>>;
export type AccountMap = Record<string, { code: string; create: boolean; name_en?: string; name_so?: string; type?: GlType }>;

export const FIELDS: Record<Entity, { field: string; required: boolean; kind: "text" | "number" | "date" | "money" }[]> = {
  accounts: [
    { field: "key", required: true, kind: "text" },
    { field: "code", required: false, kind: "text" },
    { field: "name", required: true, kind: "text" },
    { field: "name_so", required: false, kind: "text" },
    { field: "type", required: false, kind: "text" },
  ],
  entries: [
    { field: "key", required: true, kind: "text" },
    { field: "date", required: true, kind: "date" },
    { field: "ref", required: false, kind: "text" },
    { field: "memo", required: false, kind: "text" },
  ],
  lines: [
    { field: "entry_key", required: true, kind: "text" },
    { field: "account_key", required: true, kind: "text" },
    { field: "district", required: false, kind: "text" },
    { field: "debit", required: false, kind: "money" },
    { field: "credit", required: false, kind: "money" },
    { field: "amount", required: false, kind: "money" },
    { field: "side", required: false, kind: "text" },
    { field: "date", required: false, kind: "date" },
    { field: "ref", required: false, kind: "text" },
    { field: "memo", required: false, kind: "text" },
  ],
};

const SYNONYMS: Record<string, string[]> = {
  key: ["id", "acc_id", "account_id", "jv_id", "journal_id", "entry_id", "voucher_id", "trans_id", "transaction_id"],
  code: ["code", "acc_code", "account_code", "account_no", "acc_no", "gl_code", "number"],
  name: ["name", "acc_name", "account_name", "name_en", "title", "description"],
  name_so: ["name_so", "magaca", "acc_name_so"],
  type: ["type", "acc_type", "account_type", "category", "class", "nature"],
  date: ["date", "entry_date", "jv_date", "trans_date", "transaction_date", "posting_date", "voucher_date", "created_at"],
  ref: ["ref", "reference", "jv_no", "voucher_no", "entry_no", "number", "doc_no", "receipt_no"],
  memo: ["memo", "narration", "description", "details", "remarks", "note", "particulars"],
  entry_key: ["jv_no", "jv_id", "journal_id", "entry_id", "voucher_no", "voucher_id", "trans_id", "transaction_id", "entry_no", "ref"],
  account_key: ["acc_id", "account_id", "acc_code", "account_code", "account", "gl_code", "account_no"],
  district: ["district", "district_id", "district_code", "degmo", "branch", "office"],
  debit: ["debit", "dr", "debit_amount", "dr_amount"],
  credit: ["credit", "cr", "credit_amount", "cr_amount"],
  amount: ["amount", "value", "amt", "total"],
  side: ["side", "dr_cr", "drcr", "type", "entry_type", "nature"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What an old table probably holds, from its name and columns. */
export function suggestTable(name: string, columns: string[]): TableTarget {
  const n = norm(name);
  const cols = columns.map(norm);
  const has = (...xs: string[]) => xs.some((x) => cols.includes(norm(x)));
  if (/(account|acc|coa|chart|ledgeracc|glacc)/.test(n) && !/(line|detail|entry|trans|journal)/.test(n)) return "accounts";
  if (/(journal|voucher|jv|trans|gl|ledger|entr)/.test(n)) {
    if (/(line|detail|item|split|row)/.test(n)) return "lines";
    if (has("debit", "dr", "credit", "cr", "amount") && has(...SYNONYMS.account_key!)) return "lines";
    return "entries";
  }
  return "ignore";
}

/** The old column that best fits each of our fields (exact name first, then a known other name). */
export function suggestColumns(entity: Entity, columns: string[]): Record<string, FieldMap> {
  const out: Record<string, FieldMap> = {};
  const used = new Set<string>();
  for (const f of FIELDS[entity]) {
    const pick =
      columns.find((c) => norm(c) === norm(f.field) && !used.has(c)) ??
      (SYNONYMS[f.field] ?? []).map((s) => columns.find((c) => norm(c) === norm(s) && !used.has(c))).find(Boolean) ??
      null;
    if (pick) used.add(pick);
    out[f.field] = { col: pick, transform: f.kind === "date" ? "date" : f.kind === "money" ? "number" : "trim", format: f.kind === "date" ? "auto" : undefined };
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y > 1900 && y < 2200;
};

/** A date as YYYY-MM-DD, or null when it can't be read the way it was asked. */
export function toDate(v: Cell, format: DateFormat = "auto"): string | null {
  if (v === null || v === "") return null;
  const s = String(v).trim();
  if (format === "unix" || (format === "auto" && /^\d{9,10}$/.test(s))) {
    const d = new Date(Number(s) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  const other = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  let y: number, m: number, d: number;
  if (ymd && (format === "auto" || format === "ymd")) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else if (other && format === "mdy") [y, m, d] = [Number(other[3]), Number(other[1]), Number(other[2])];
  else if (other && (format === "dmy" || format === "auto")) [y, m, d] = [Number(other[3]), Number(other[2]), Number(other[1])];
  else return null;
  return validYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A number from "1,250.50", "(40)" or "-40"; null when it isn't one. */
export function toNumber(v: Cell): number | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") return v;
  let s = v.trim().replace(/[\s,]/g, "").replace(/^\$|USD$/i, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/** One field of one old row, after its transform; `bad` when the old value can't be read as asked. */
export function fieldValue(row: Row, m: FieldMap | undefined): { value: string | number | null; bad?: string } {
  if (!m) return { value: null };
  const raw = m.col ? (row[m.col] ?? null) : null;
  const empty = raw === null || (typeof raw === "string" && raw.trim() === "");
  const src: Cell = empty ? (m.default !== undefined && m.default !== "" ? m.default : null) : raw;
  if (src === null) return { value: null };
  switch (m.transform ?? "none") {
    case "trim":
      return { value: String(src).trim() };
    case "upper":
      return { value: String(src).trim().toUpperCase() };
    case "lower":
      return { value: String(src).trim().toLowerCase() };
    case "number": {
      const n = toNumber(src);
      if (n === null) return { value: null, bad: `"${String(src).slice(0, 30)}" is not a number` };
      return { value: Math.round(n * (m.factor && m.factor > 0 ? m.factor : 1) * 100) / 100 };
    }
    case "date": {
      const d = toDate(src, m.format);
      return d ? { value: d } : { value: null, bad: `"${String(src).slice(0, 30)}" is not a date` };
    }
    default:
      return { value: typeof src === "number" ? src : String(src) };
  }
}

/** Our account type from the old one (A/asset, L/liability, E/equity/capital, I/income/revenue, X/E…/expense). */
export function toGlType(v: string | number | null): GlType | null {
  const s = norm(String(v ?? ""));
  if (!s) return null;
  if (/^(a|asset|assets|1)$/.test(s) || s.startsWith("asset")) return "asset";
  if (/^(l|liab|liability|liabilities|2)$/.test(s) || s.startsWith("liab")) return "liability";
  if (/^(e|eq|equity|capital|3)$/.test(s) || s.startsWith("equit") || s.startsWith("capital")) return "equity";
  if (/^(i|r|inc|income|revenue|4)$/.test(s) || s.startsWith("income") || s.startsWith("revenue")) return "income";
  if (/^(x|ex|exp|expense|expenses|cost|5)$/.test(s) || s.startsWith("expen")) return "expense";
  return null;
}

export interface PreparedItem {
  entity: "account" | "entry";
  source_key: string;
  status: "ready" | "error" | "skipped";
  message?: string;
  data: Record<string, unknown>;
}
export interface Prepared {
  items: PreparedItem[];
  /** Every old account key the lines use (for the ID mapping), with the old name when known. */
  accountKeys: { key: string; code: string | null; name: string | null; type: GlType | null; lines: number }[];
  /** Every old district value the lines use. */
  districtKeys: { key: string; lines: number }[];
  warnings: string[];
  summary: { accounts: Record<string, number>; entries: Record<string, number>; lines: number; debit: number; credit: number };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The records the migration would make. Accounts: one per old account (mapped to one of ours, or created).
 * Entries: one per old journal entry, its lines grouped by the entry key; each must have a date, at least two lines,
 * equal debits and credits, and an account here for every line.
 */
export function prepare(input: {
  tables: Record<string, Row[]>;
  tableMap: Record<string, TableTarget>;
  columnMap: ColumnMap;
  accountMap: AccountMap;
  /** Our account codes. */
  ourAccounts: string[];
}): Prepared {
  const { tables, tableMap, columnMap, accountMap } = input;
  const ours = new Set(input.ourAccounts);
  const rowsOf = (e: Entity) =>
    Object.entries(tableMap)
      .filter(([, t]) => t === e)
      .flatMap(([name]) => tables[name] ?? []);
  const warnings: string[] = [];
  const items: PreparedItem[] = [];

  // ---- Accounts --------------------------------------------------------------------------------------------------
  const accountInfo = new Map<string, { code: string | null; name: string | null; name_so: string | null; type: GlType | null }>();
  for (const r of rowsOf("accounts")) {
    const m = columnMap.accounts ?? {};
    const key = fieldValue(r, m.key).value;
    if (key === null) continue;
    const type = fieldValue(r, m.type).value;
    accountInfo.set(String(key), {
      code: (fieldValue(r, m.code).value as string | null) ?? null,
      name: (fieldValue(r, m.name).value as string | null) ?? null,
      name_so: (fieldValue(r, m.name_so).value as string | null) ?? null,
      type: toGlType(type),
    });
  }

  // ---- Lines, grouped into entries ---------------------------------------------------------------------------------
  type Line = { account_key: string; district_key: string | null; debit: number; credit: number };
  const lineMap = columnMap.lines ?? {};
  const groups = new Map<string, { lines: Line[]; date: string | null; ref: string | null; memo: string | null; problems: string[] }>();
  const accountUse = new Map<string, number>();
  const districtUse = new Map<string, number>();
  let lineCount = 0;
  for (const r of rowsOf("lines")) {
    const key = fieldValue(r, lineMap.entry_key).value;
    if (key === null) {
      warnings.push("A journal line has no entry key and was left out.");
      continue;
    }
    const g = groups.get(String(key)) ?? { lines: [], date: null, ref: null, memo: null, problems: [] };
    groups.set(String(key), g);
    const acct = fieldValue(r, lineMap.account_key).value;
    const district = fieldValue(r, lineMap.district).value;
    const bad: string[] = [];
    const num = (f: string) => {
      const v = fieldValue(r, lineMap[f]);
      if (v.bad) bad.push(`${f}: ${v.bad}`);
      return (v.value as number | null) ?? 0;
    };
    let debit = num("debit");
    let credit = num("credit");
    if (!lineMap.debit?.col && !lineMap.credit?.col) {
      const amount = num("amount");
      const side = norm(String(fieldValue(r, lineMap.side).value ?? ""));
      if (/^(c|cr|credit|2)$/.test(side)) credit = Math.abs(amount);
      else if (/^(d|dr|debit|1)$/.test(side)) debit = Math.abs(amount);
      else if (amount < 0) credit = -amount;
      else debit = amount;
    }
    // A negative on one side is the other side.
    if (debit < 0) [credit, debit] = [credit - debit, 0];
    if (credit < 0) [debit, credit] = [debit - credit, 0];
    if (!g.date) g.date = fieldValue(r, lineMap.date).value as string | null;
    if (!g.ref) g.ref = fieldValue(r, lineMap.ref).value as string | null;
    if (!g.memo) g.memo = fieldValue(r, lineMap.memo).value as string | null;
    g.problems.push(...bad);
    if (acct === null) g.problems.push("a line has no account");
    else accountUse.set(String(acct), (accountUse.get(String(acct)) ?? 0) + 1);
    if (district !== null) districtUse.set(String(district), (districtUse.get(String(district)) ?? 0) + 1);
    if (debit === 0 && credit === 0) continue;
    g.lines.push({ account_key: String(acct ?? ""), district_key: district === null ? null : String(district), debit: cents(debit), credit: cents(credit) });
    lineCount++;
  }
  // Entry headers (when the old system keeps them in their own table).
  const headMap = columnMap.entries ?? {};
  const seenEntries = new Set<string>();
  for (const r of rowsOf("entries")) {
    const key = fieldValue(r, headMap.key).value;
    if (key === null) continue;
    const k = String(key);
    if (seenEntries.has(k)) {
      items.push({ entity: "entry", source_key: `${k}#dup${items.length}`, status: "skipped", message: "repeated entry key", data: {} });
      continue;
    }
    seenEntries.add(k);
    const g = groups.get(k) ?? { lines: [], date: null, ref: null, memo: null, problems: [] };
    groups.set(k, g);
    const d = fieldValue(r, headMap.date);
    if (d.bad) g.problems.push(`date: ${d.bad}`);
    g.date = (d.value as string | null) ?? g.date;
    g.ref = (fieldValue(r, headMap.ref).value as string | null) ?? g.ref;
    g.memo = (fieldValue(r, headMap.memo).value as string | null) ?? g.memo;
  }

  // ---- Account items: every account the old system had, plus any the lines use ----------------------------------------
  const resolvable = new Set<string>();
  const allKeys = new Set([...accountInfo.keys(), ...accountUse.keys()]);
  const accountKeys: Prepared["accountKeys"] = [];
  for (const key of [...allKeys].sort()) {
    const info = accountInfo.get(key) ?? { code: null, name: null, name_so: null, type: null };
    accountKeys.push({ key, code: info.code, name: info.name, type: info.type, lines: accountUse.get(key) ?? 0 });
    const set = accountMap[key];
    const guess = [info.code, key].find((c) => c && /^\d{4}$/.test(c)) ?? null;
    const code = set?.code ?? guess;
    const create = set ? set.create : Boolean(code && !ours.has(code));
    const nameEn = set?.name_en || info.name || "";
    const type = set?.type ?? info.type;
    let message: string | undefined;
    if (!code) message = "choose one of our accounts, or a new 4-digit code";
    else if (!/^\d{4}$/.test(code)) message = `"${code}" is not a 4-digit code`;
    else if (!create && !ours.has(code)) message = `our account ${code} doesn't exist`;
    else if (create && ours.has(code)) message = undefined; // already there: it is used, not made again
    else if (create && !nameEn) message = "a new account needs a name";
    else if (create && !type) message = "a new account needs a type";
    if (!message) resolvable.add(key);
    items.push({
      entity: "account",
      source_key: key,
      status: message ? "error" : "ready",
      message,
      data: { code, create: create && !ours.has(code ?? ""), name_en: nameEn, name_so: set?.name_so || info.name_so || nameEn, type, old_name: info.name },
    });
  }

  // ---- Entry items --------------------------------------------------------------------------------------------------
  let debit = 0;
  let credit = 0;
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const problems = [...new Set(g.problems)];
    if (!g.date) problems.push("no date");
    if (g.lines.length < 2) problems.push("fewer than two lines");
    const dr = cents(g.lines.reduce((s, l) => s + l.debit, 0));
    const cr = cents(g.lines.reduce((s, l) => s + l.credit, 0));
    if (dr !== cr) problems.push(`debits ${dr} and credits ${cr} are not equal`);
    const unknown = [...new Set(g.lines.filter((l) => !resolvable.has(l.account_key) && !ours.has(l.account_key)).map((l) => l.account_key))];
    if (unknown.length) problems.push(`no account here for ${unknown.slice(0, 5).join(", ")}`);
    if (!problems.length) {
      debit += dr;
      credit += cr;
    }
    items.push({
      entity: "entry",
      source_key: key,
      status: problems.length ? "error" : "ready",
      message: problems.length ? problems.join("; ") : undefined,
      data: { date: g.date, ref: g.ref ?? key, memo: g.memo, lines: g.lines },
    });
  }

  const tally = (e: "account" | "entry") =>
    items.filter((i) => i.entity === e).reduce<Record<string, number>>((s, i) => ({ ...s, [i.status]: (s[i.status] ?? 0) + 1 }), {});
  return {
    items,
    accountKeys,
    districtKeys: [...districtUse.entries()].map(([key, lines]) => ({ key, lines })).sort((a, b) => a.key.localeCompare(b.key)),
    warnings: [...new Set(warnings)],
    summary: { accounts: tally("account"), entries: tally("entry"), lines: lineCount, debit: cents(debit), credit: cents(credit) },
  };
}
