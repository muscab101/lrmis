/**
 * Reading an old database for the migration center: a MySQL dump (.sql, as written by mysqldump or phpMyAdmin) or CSV
 * files (one table each). Only reads — the file is never run against any database.
 */

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface SourceColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface SourceTable {
  name: string;
  columns: SourceColumn[];
  primary_key: string[];
  foreign_keys: { columns: string[]; ref_table: string; ref_columns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  rows: Row[];
  row_count: number;
  stats: { nulls: Record<string, number>; duplicates: number };
}

const ident = (s: string) => s.trim().replace(/^[`"[]|[`"\]]$/g, "");
const identList = (s: string) =>
  s
    .split(",")
    .map((x) => ident(x.replace(/\(\d+\)\s*$/, "")))
    .filter(Boolean);

/** Split a dump into statements on `;` outside strings, identifiers and comments; comments are dropped. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    // Comments: -- … , # … , /* … */ (including MySQL's /*! … */ version comments).
    if ((c === "-" && next === "-" && /\s|$/.test(sql[i + 2] ?? "")) || c === "#") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      // A version comment ends its own statement: `/*!40101 SET … */;`
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        const d = sql[i]!;
        cur += d;
        i++;
        if (d === "\\" && q !== "`") {
          if (i < n) cur += sql[i++];
          continue;
        }
        if (d === q) {
          if (sql[i] === q) {
            cur += sql[i++];
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split on commas that are not inside brackets or quotes. */
function topLevelParts(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      cur += c;
      if (c === "\\" && quote !== "`") {
        cur += s[++i] ?? "";
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseCreate(stmt: string): Omit<SourceTable, "rows" | "row_count" | "stats"> | null {
  const m = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`|[\w$]+)(?:\.(?:`[^`]+`|[\w$]+))?)\s*\(([\s\S]*)\)[^)]*$/i.exec(stmt);
  if (!m) return null;
  const name = ident(m[1]!.split(".").pop()!);
  const table: Omit<SourceTable, "rows" | "row_count" | "stats"> = { name, columns: [], primary_key: [], foreign_keys: [], indexes: [] };
  for (const part of topLevelParts(m[2]!)) {
    let k: RegExpExecArray | null;
    if ((k = /^PRIMARY\s+KEY\s*(?:\w+\s*)?\(([^)]*(?:\([^)]*\)[^)]*)*)\)/i.exec(part))) table.primary_key = identList(k[1]!);
    else if ((k = /^(?:CONSTRAINT\s+(?:`[^`]+`|\w+)\s+)?FOREIGN\s+KEY\s*(?:`[^`]+`|\w+)?\s*\(([^)]*)\)\s*REFERENCES\s+((?:`[^`]+`|[\w$.]+))\s*\(([^)]*)\)/i.exec(part)))
      table.foreign_keys.push({ columns: identList(k[1]!), ref_table: ident(k[2]!.split(".").pop()!), ref_columns: identList(k[3]!) });
    else if ((k = /^(UNIQUE\s+)?(?:KEY|INDEX)\s+((?:`[^`]+`|\w+))?\s*(?:USING\s+\w+\s*)?\(([^)]*(?:\([^)]*\)[^)]*)*)\)/i.exec(part)))
      table.indexes.push({ name: k[2] ? ident(k[2]) : "", columns: identList(k[3]!), unique: Boolean(k[1]) });
    else if ((k = /^UNIQUE\s*\(([^)]*)\)/i.exec(part))) table.indexes.push({ name: "", columns: identList(k[1]!), unique: true });
    else if (/^(FULLTEXT|SPATIAL|CHECK|CONSTRAINT)\b/i.test(part)) continue;
    else if ((k = /^(`[^`]+`|"[^"]+"|[\w$]+)\s+([\s\S]*)$/.exec(part))) {
      const rest = k[2]!;
      const type = (/^([a-z]+(?:\s*\([^)]*\))?(?:\s+unsigned)?(?:\s+zerofill)?)/i.exec(rest)?.[1] ?? rest.split(/\s+/)[0] ?? "").toLowerCase();
      const def = /\bDEFAULT\s+('(?:[^'\\]|\\.|'')*'|[^\s,]+)/i.exec(rest)?.[1] ?? null;
      table.columns.push({
        name: ident(k[1]!),
        type,
        nullable: !/\bNOT\s+NULL\b/i.test(rest),
        default: def === null || /^NULL$/i.test(def) ? null : def.replace(/^'|'$/g, ""),
      });
      if (/\bPRIMARY\s+KEY\b/i.test(rest)) table.primary_key = [ident(k[1]!)];
      if (/\bUNIQUE\b/i.test(rest)) table.indexes.push({ name: ident(k[1]!), columns: [ident(k[1]!)], unique: true });
    }
  }
  return table;
}

const ESCAPES: Record<string, string> = { "0": "\0", b: "\b", n: "\n", r: "\r", t: "\t", Z: "\x1a" };

/** The rows of `VALUES (…), (…)` as arrays of cells. Big numbers (IDs over 15 digits) stay text. */
export function parseValues(s: string): Cell[][] {
  const rows: Cell[][] = [];
  let i = 0;
  const n = s.length;
  const ws = () => {
    while (i < n && /\s/.test(s[i]!)) i++;
  };
  while (i < n) {
    ws();
    if (s[i] === ",") {
      i++;
      continue;
    }
    if (s[i] !== "(") break;
    i++;
    const row: Cell[] = [];
    for (;;) {
      ws();
      const c = s[i];
      if (c === ")") {
        i++;
        break;
      }
      if (c === ",") {
        i++;
        continue;
      }
      if (c === "'" || c === '"' || (c === "_" && /^_\w+\s*'/.test(s.slice(i, i + 20)))) {
        if (c === "_") i = s.indexOf("'", i);
        const q = s[i]!;
        i++;
        let v = "";
        while (i < n) {
          const d = s[i]!;
          if (d === "\\") {
            const e = s[i + 1] ?? "";
            v += ESCAPES[e] ?? e;
            i += 2;
            continue;
          }
          if (d === q) {
            if (s[i + 1] === q) {
              v += q;
              i += 2;
              continue;
            }
            i++;
            break;
          }
          v += d;
          i++;
        }
        row.push(v);
        continue;
      }
      let j = i;
      while (j < n && s[j] !== "," && s[j] !== ")") j++;
      const raw = s.slice(i, j).trim();
      i = j;
      if (/^NULL$/i.test(raw)) row.push(null);
      else if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw)) row.push(raw.replace(/^-/, "").replace(".", "").length > 15 ? raw : Number(raw));
      else if (/^0x[0-9a-f]*$/i.test(raw) || /^[xb]'[0-9a-f]*'$/i.test(raw)) row.push(raw);
      else row.push(raw);
    }
    rows.push(row);
  }
  return rows;
}

function parseInsert(stmt: string): { table: string; columns: string[] | null; rows: Cell[][] } | null {
  const m = /^(?:INSERT|REPLACE)\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+)?(?:IGNORE\s+)?(?:INTO\s+)?((?:`[^`]+`|[\w$]+)(?:\.(?:`[^`]+`|[\w$]+))?)\s*(\([^)]*\))?\s*VALUES\s*([\s\S]*)$/i.exec(stmt);
  if (!m) return null;
  return {
    table: ident(m[1]!.split(".").pop()!),
    columns: m[2] ? identList(m[2].slice(1, -1)) : null,
    rows: parseValues(m[3]!.replace(/\s*ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]*$/i, "")),
  };
}

/** Nulls per column and repeated rows (same primary key, or the same whole row when there is none). */
export function tableStats(columns: string[], primaryKey: string[], rows: Row[]): SourceTable["stats"] {
  const nulls: Record<string, number> = Object.fromEntries(columns.map((c) => [c, 0]));
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of rows) {
    for (const c of columns) if (r[c] === null || r[c] === undefined || r[c] === "") nulls[c] = (nulls[c] ?? 0) + 1;
    const key = JSON.stringify(primaryKey.length ? primaryKey.map((c) => r[c]) : columns.map((c) => r[c]));
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return { nulls, duplicates };
}

/** Every table in a MySQL dump: structure from CREATE TABLE, rows from INSERT statements. */
export function parseMysqlDump(sql: string): SourceTable[] {
  const tables = new Map<string, SourceTable>();
  const get = (name: string) => {
    let t = tables.get(name);
    if (!t) {
      t = { name, columns: [], primary_key: [], foreign_keys: [], indexes: [], rows: [], row_count: 0, stats: { nulls: {}, duplicates: 0 } };
      tables.set(name, t);
    }
    return t;
  };
  for (const stmt of splitStatements(sql.replace(/^﻿/, ""))) {
    if (/^CREATE\s+(TEMPORARY\s+)?TABLE/i.test(stmt)) {
      const c = parseCreate(stmt);
      if (c) Object.assign(get(c.name), c);
    } else if (/^(INSERT|REPLACE)\b/i.test(stmt)) {
      const ins = parseInsert(stmt);
      if (!ins) continue;
      const t = get(ins.table);
      const cols = ins.columns ?? t.columns.map((c) => c.name);
      for (const values of ins.rows) {
        const row: Row = {};
        cols.forEach((c, k) => (row[c] = values[k] ?? null));
        // A dump without CREATE TABLE: the columns come from the inserts.
        for (const c of cols) if (!t.columns.some((x) => x.name === c)) t.columns.push({ name: c, type: "", nullable: true, default: null });
        t.rows.push(row);
      }
    }
  }
  for (const t of tables.values()) {
    t.row_count = t.rows.length;
    t.stats = tableStats(
      t.columns.map((c) => c.name),
      t.primary_key,
      t.rows,
    );
  }
  return [...tables.values()];
}

/** One CSV file as a table: the first line names the columns; comma, semicolon or tab, found by itself. */
export function parseCsv(name: string, text: string): SourceTable {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") < 0 ? src.length : src.indexOf("\n"));
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) records.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) records.push(row);
  const header = (records.shift() ?? []).map((h, i) => h.trim() || `column_${i + 1}`);
  const rows: Row[] = records.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined || r[i] === "" ? null : r[i]!])));
  const columns: SourceColumn[] = header.map((h) => {
    const vals = rows.map((r) => r[h]).filter((v): v is string => typeof v === "string");
    const type = vals.length && vals.every((v) => /^-?[\d,]*\.?\d+$/.test(v)) ? "number" : vals.length && vals.every((v) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v)) ? "date" : "text";
    return { name: h, type, nullable: true, default: null };
  });
  const tableName = name.replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_");
  return { name: tableName, columns, primary_key: [], foreign_keys: [], indexes: [], rows, row_count: rows.length, stats: tableStats(header, [], rows) };
}
