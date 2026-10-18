/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF), as saved by Excel. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  // Excel in some locales saves with semicolons.
  const sep = (src.split(/\r?\n/, 1)[0] ?? "").split(";").length > (src.split(/\r?\n/, 1)[0] ?? "").split(",").length ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const LEGACY_COLUMNS = [
  "legacy_ref",
  "full_name",
  "mother_name",
  "gender",
  "phone",
  "id_type",
  "id_number",
  "district_code",
  "neighbourhood_code",
  "lon",
  "lat",
  "plot_no",
  "old_deed_no",
  "govt_file_no",
  "address_note",
] as const;
