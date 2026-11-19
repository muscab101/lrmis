#!/usr/bin/env python3
"""
Turns the old LRMIS MySQL dump (phpMyAdmin, MySQL 5.6, lrmisdb3) into two PostgreSQL files:

  01_legacy_schema.sql  every old table, unchanged in content, in its own schema `legacy`
  02_legacy_data.sql    every old row as INSERTs (nothing dropped, nothing merged)

The old rows are kept exactly as they were, except where PostgreSQL can't hold the MySQL value:
  - '0000-00-00' and '0000-00-00 00:00:00' (MySQL's "no date") become NULL, and date columns are nullable;
  - dates that do not exist (month 00, 31 February …) become NULL and are listed in legacy._conversion_notes;
  - MySQL tinyint/int/double/float become smallint/bigint/numeric (money never goes through floating point).

Usage:  python3 -I convert_dump.py "<path to lrmisdb3.sql>" <output folder>
"""
import datetime
import hashlib
import json
import os
import re
import sys

src_path, out_dir = sys.argv[1], sys.argv[2]
raw = open(src_path, "rb").read()
sha256 = hashlib.sha256(raw).hexdigest()
data = raw.decode("utf-8")

# ---- Table structure -------------------------------------------------------------------------------------------------

tables = {}   # name -> [(column, mysql type, not null, default)]
for m in re.finditer(r"CREATE TABLE `(\w+)` \((.*?)\n\) ENGINE", data, re.S):
    cols = []
    for line in m.group(2).split("\n"):
        mm = re.match(r"\s*`(\w+)`\s+(.*?),?$", line)
        if not mm:
            continue
        rest = mm.group(2)
        cols.append((mm.group(1), rest, "NOT NULL" in rest, re.search(r"DEFAULT ('[^']*'|\w+)", rest)))
    tables[m.group(1)] = cols

pkeys = {}
for m in re.finditer(r"ALTER TABLE `(\w+)`\s+ADD PRIMARY KEY \(([^)]*)\)", data):
    pkeys[m.group(1)] = [c.strip(" `") for c in m.group(2).split(",")]


def pg_type(table, col, mysql):
    t = mysql.lower()
    if t.startswith("tinyint"):
        return "smallint"
    if t.startswith("smallint"):
        return "smallint"
    if t.startswith("int"):
        return "bigint"
    if t.startswith("double") or t.startswith("float"):
        return "numeric"
    if t.startswith("varchar") or t.startswith("char") or t.startswith("text"):
        return "text"
    if t.startswith("datetime"):
        return "timestamp"
    if t.startswith("timestamp"):
        return "timestamp"
    if t.startswith("date"):
        return "date"
    raise SystemExit(f"type not handled: {table}.{col} {mysql}")


def ident(name):
    # Postgres folds unquoted names to lower case; keep the old names exactly (UserTypeCode, C, R …).
    return '"' + name + '"' if (name != name.lower() or name in ("user", "type", "action", "level")) else name


# ---- Rows ------------------------------------------------------------------------------------------------------------

ESC = {"n": "\n", "r": "\r", "t": "\t", "0": "", "Z": "\x1a", "b": "\b"}


def parse_values(s, i):
    rows, n = [], len(s)
    while i < n:
        while i < n and s[i] in " \n\r\t,":
            i += 1
        if i >= n or s[i] == ";":
            break
        assert s[i] == "(", s[i - 40:i + 40]
        i += 1
        row = []
        while True:
            while s[i] in " \n":
                i += 1
            if s[i] == "'":
                i += 1
                buf = []
                while True:
                    c = s[i]
                    if c == "\\":
                        nx = s[i + 1]
                        buf.append(ESC.get(nx, nx))
                        i += 2
                    elif c == "'":
                        if s[i + 1] == "'":
                            buf.append("'")
                            i += 2
                        else:
                            i += 1
                            break
                    else:
                        buf.append(c)
                        i += 1
                row.append(("s", "".join(buf)))
            else:
                j = i
                while s[j] not in ",)":
                    j += 1
                tok = s[i:j].strip()
                i = j
                row.append(("n", None if tok == "NULL" else tok))
            while s[i] in " \n":
                i += 1
            if s[i] == ",":
                i += 1
                continue
            if s[i] == ")":
                i += 1
                break
        rows.append(row)
    return rows, i


rows = {t: [] for t in tables}
inscols = {}
for m in re.finditer(r"INSERT INTO `(\w+)` \(([^)]*)\) VALUES", data):
    t = m.group(1)
    inscols[t] = [c.strip(" `") for c in m.group(2).split(",")]
    got, _ = parse_values(data, m.end())
    rows[t].extend(got)

notes = []   # (table, id, column, old value, what was done)


def valid_date(v, with_time):
    try:
        if with_time:
            d = datetime.datetime.strptime(v, "%Y-%m-%d %H:%M:%S")
        else:
            d = datetime.datetime.strptime(v, "%Y-%m-%d")
        return d.year >= 1   # PostgreSQL holds any year from 1 AD; odd years (1845, 2105) are kept and judged when staging
    except ValueError:
        return False


def sql_value(table, key, col, pgt, kind, v):
    if v is None:
        return "NULL"
    if pgt in ("date", "timestamp"):
        if v.startswith("0000-00-00"):
            return "NULL"
        if not valid_date(v, pgt == "timestamp"):
            notes.append((table, key, col, v, "impossible date, kept as NULL"))
            return "NULL"
        return "'" + v + "'"
    if pgt in ("smallint", "bigint", "numeric"):
        if kind == "s":
            v = v.strip()
            if v == "":
                notes.append((table, key, col, "''", "empty number, kept as NULL"))
                return "NULL"
        if not re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", v):
            notes.append((table, key, col, v, "not a number, kept as NULL"))
            return "NULL"
        return v
    return "'" + v.replace("'", "''") + "'"


# ---- 01: schema ------------------------------------------------------------------------------------------------------

out = []
out.append(f"""-- ============================================================================================================
-- Old LRMIS (lrmisdb3, MySQL 5.6, dumped 9 Mar 2016) as PostgreSQL: schema `legacy`.
-- Generated by convert_dump.py from the dump with SHA-256 {sha256}.
-- Every old table is here with every column, so nothing is lost; the new system reads from it (03_stage_migration.sql)
-- and never writes to it. The schema is not exposed to the API (only `public` is), and RLS is on with no policies.
-- ============================================================================================================

create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;
comment on schema legacy is 'Old LRMIS (2015-2016) data, kept unchanged for the migration and as an archive. Read-only.';
""")
for t, cols in tables.items():
    lines = []
    for c, mysql, notnull, default in cols:
        pgt = pg_type(t, c, mysql)
        nn = " not null" if notnull and pgt not in ("date", "timestamp") else ""
        lines.append(f"  {ident(c)} {pgt}{nn}")
    pk = pkeys.get(t)
    if pk:
        lines.append(f"  primary key ({', '.join(ident(c) for c in pk)})")
    out.append(f"create table if not exists legacy.{t} (\n" + ",\n".join(lines) + "\n);")
    out.append(f"alter table legacy.{t} enable row level security;")
out.append("""
-- Lookups the migration makes (the old database had no indexes besides primary keys).
create index if not exists dr_trans_reference_idx on legacy.dr_trans (reference_no);
create index if not exists dr_trans_parcel_idx on legacy.dr_trans (parcel_id, transaction_type);
create index if not exists invoice_list_reference_idx on legacy.invoice_list (reference_no, date_created);
create index if not exists land_units_parcel_idx on legacy.land_units (parcel_id);
create index if not exists land_parcels_owner_idx on legacy.land_parcels (owner_id);
create index if not exists land_owners_email_idx on legacy.land_owners (lower(trim(email_address)));
""")
out.append("""
-- What the conversion had to change (impossible dates, empty numbers): the old value is kept here.
create table if not exists legacy._conversion_notes (
  table_name text not null,
  row_key    text not null,
  column_name text not null,
  old_value  text,
  action     text not null
);
alter table legacy._conversion_notes enable row level security;

create table if not exists legacy._source (
  file_name text not null,
  sha256    text not null,
  converted_at timestamptz not null default now(),
  row_counts jsonb not null
);
alter table legacy._source enable row level security;
""")
open(os.path.join(out_dir, "01_legacy_schema.sql"), "w").write("\n".join(out) + "\n")

# ---- 02: data --------------------------------------------------------------------------------------------------------

out = ["-- Old LRMIS rows (generated by convert_dump.py). Load after 01_legacy_schema.sql. Contains personal data: keep private.",
       "set client_encoding = 'UTF8';", "set standard_conforming_strings = on;", "begin;"]
counts = {}
for t, cols in tables.items():
    types = {c: pg_type(t, c, mysql) for c, mysql, _, _ in cols}
    names = inscols.get(t, [c for c, *_ in cols])
    pk = pkeys.get(t, [names[0]])
    counts[t] = len(rows[t])
    if not rows[t]:
        continue
    out.append(f"\n-- {t}: {len(rows[t])} rows")
    for start in range(0, len(rows[t]), 500):
        vals = []
        for r in rows[t][start:start + 500]:
            key = "/".join(str(v) for (k, v), c in zip(r, names) if c in pk)
            vals.append("(" + ", ".join(sql_value(t, key, c, types[c], k, v) for (k, v), c in zip(r, names)) + ")")
        out.append(f"insert into legacy.{t} ({', '.join(ident(c) for c in names)}) values\n" + ",\n".join(vals) + ";")
if notes:
    out.append("\ninsert into legacy._conversion_notes (table_name, row_key, column_name, old_value, action) values\n" +
               ",\n".join("(" + ", ".join("'" + str(x).replace("'", "''") + "'" for x in n) + ")" for n in notes) + ";")
out.append(f"\ninsert into legacy._source (file_name, sha256, row_counts) values ('{os.path.basename(src_path).replace(chr(39), chr(39) * 2)}', "
           f"'{sha256}', '{json.dumps(counts)}');")
out.append("commit;")
open(os.path.join(out_dir, "02_legacy_data.sql"), "w").write("\n".join(out) + "\n")

# Optional: the same rows as JSON (one file per table) for loading through the API: --json <folder>.
if "--json" in sys.argv:
    jdir = sys.argv[sys.argv.index("--json") + 1]
    os.makedirs(jdir, exist_ok=True)
    for t, cols in tables.items():
        types = {c: pg_type(t, c, mysql) for c, mysql, _, _ in cols}
        names = inscols.get(t, [c for c, *_ in cols])
        out_rows = []
        for r in rows[t]:
            o = {}
            for (k, v), c in zip(r, names):
                lit = sql_value(t, "", c, types[c], k, v)
                o[c] = None if lit == "NULL" else (lit[1:-1].replace("''", "'") if lit.startswith("'") else lit)
            out_rows.append(o)
        json.dump(out_rows, open(os.path.join(jdir, t + ".json"), "w"))
    json.dump({"file_name": os.path.basename(src_path), "sha256": sha256, "row_counts": counts}, open(os.path.join(jdir, "_source.json"), "w"))

print(json.dumps({"sha256": sha256, "tables": len(tables), "rows": sum(counts.values()), "notes": len(notes)}))
for n in notes:
    print("note:", n)
