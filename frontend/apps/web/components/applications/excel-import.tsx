"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Download, FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { importLegacyAction } from "@/app/[locale]/(staff)/applications/import/actions";
import { FormError } from "@/components/forms/form-error";
import { LEGACY_COLUMNS, parseCsv } from "@/lib/import/csv";

type Result = { row: number; ref: string; status: string; number?: string; problems?: string[] };
type Row = Record<(typeof LEGACY_COLUMNS)[number], string>;

const SAMPLE = `${LEGACY_COLUMNS.join(",")}\nOLD-HDN-000001,Faadumo Cali Nuur,Xaliimo Maxamed,female,0615550123,national_id,SO123456,HDN,,,,12,D-1987-77,F-301,Near the blue gate\n`;

/** Upload a CSV saved from Excel, check every row, then import the clean file. */
export function ExcelImport() {
  const t = useTranslations("applications.import");
  const [name, setName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [committed, setCommitted] = useState(false);
  const [batch, setBatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function onFile(file: File) {
    setResults(null);
    setCommitted(false);
    setError(null);
    setName(file.name);
    const [header, ...body] = parseCsv(await file.text());
    const cols = (header ?? []).map((h) => h.trim().toLowerCase());
    setUnknown(cols.filter((c) => !(LEGACY_COLUMNS as readonly string[]).includes(c)));
    setMissing(["legacy_ref", "full_name", "district_code"].filter((c) => !cols.includes(c)));
    setRows(
      body.slice(0, 1000).map((r) => Object.fromEntries(LEGACY_COLUMNS.map((c) => [c, (r[cols.indexOf(c)] ?? "").trim()])) as Row),
    );
  }

  async function run(commit: boolean) {
    setBusy(true);
    setError(null);
    const r = await importLegacyAction({ rows, commit, batch });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResults(r.data);
    setCommitted(commit);
  }

  const tally = (results ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const clean = results && !tally.invalid && !tally.error;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-5 text-sm">
          <p className="text-muted-foreground">{t("intro")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 font-medium hover:bg-muted">
              <FileUp className="size-4" aria-hidden />
              {name ?? t("chooseFile")}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            </label>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="lrmis-import-template.csv" className="inline-flex items-center gap-1.5 text-primary hover:underline">
              <Download className="size-4" aria-hidden />
              {t("template")}
            </a>
          </div>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("columns", { list: LEGACY_COLUMNS.join(", ") })}</p>
          {rows.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <p>{t("rowsRead", { n: rows.length })}</p>
              {missing.length > 0 && <p className="text-status-rejected">{t("missingColumns", { list: missing.join(", ") })}</p>}
              {unknown.length > 0 && <p className="text-muted-foreground">{t("unknownColumns", { list: unknown.join(", ") })}</p>}
              <Field id="batch" label={t("batch")} hint={t("batchHint")}>
                <Input value={batch} onChange={(e) => setBatch(e.target.value)} className="max-w-xs" />
              </Field>
              <FormError error={error} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" loading={busy && !committed} disabled={missing.length > 0 || committed} onClick={() => void run(false)}>
                  {t("check")}
                </Button>
                <Button loading={busy} disabled={!clean || committed} onClick={() => void run(true)}>
                  {t("import", { n: rows.length })}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {results && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-4 border-b p-3 text-sm">
            <strong>{committed ? t("imported") : t("checked")}</strong>
            {Object.entries(tally).map(([k, n]) => (
              <span key={k}>
                {t(`status.${k}`)}: <span className="font-mono">{n}</span>
              </span>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("row")}</TableHead>
                <TableHead>{t("ref")}</TableHead>
                <TableHead>{t("result")}</TableHead>
                <TableHead>{t("problems")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results
                .filter((r) => r.status !== "would_create" || results.length <= 200)
                .map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="font-mono text-xs">{r.row}</TableCell>
                    <TableCell>
                      <Mono className="text-xs">{r.ref || "—"}</Mono>
                    </TableCell>
                    <TableCell className={`text-sm ${r.status === "invalid" || r.status === "error" ? "text-status-rejected" : ""}`}>
                      {t(`status.${r.status}`)} {r.number && <Mono className="text-xs">{r.number}</Mono>}
                    </TableCell>
                    <TableCell className="text-xs">{(r.problems ?? []).map((p) => (t.has(`problem.${p}`) ? t(`problem.${p}`) : p)).join(", ")}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
