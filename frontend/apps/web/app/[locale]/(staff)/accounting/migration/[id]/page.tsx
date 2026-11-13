import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { cn } from "@dhulka/ui/lib/cn";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowLeft, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ColumnMapping, IdMapping, MigrationOptions, PropertyMapping, StepButton, TableMapping, UndoMigration } from "@/components/accounting/migration/controls";
import { MIGRATION_TONE, STAGES, type Stage } from "@/components/accounting/migration/status";
import { Link } from "@/i18n/navigation";
import { ENTITIES, FIELDS, prepare, suggestTable, type AccountMap, type ColumnMap, type Entity, type TableTarget } from "@/lib/migration/prepare";
import {
  getMigration,
  itemCounts,
  mappingTargets,
  migrationBackups,
  migrationItems,
  migrationLog,
  migrationReport,
  migrationRows,
  migrationTables,
  sampleRows,
  targetSchema,
  type Migration,
  type MigrationItem,
  type RunResult,
} from "@/lib/server/acct-migration";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("migration");
  return { title: t("title") };
}

const ITEM_STATUSES = ["ready", "error", "skipped", "migrated", "failed"] as const;

/** Each of our fields the column mapping must fill, for the stage to count as done. */
function columnsDone(m: Migration) {
  const mapped = new Set(Object.values(m.table_map).filter((x) => x !== "ignore"));
  if (!mapped.has("lines") && !mapped.has("land")) return false;
  const has = (e: Entity, f: string) => Boolean((m.column_map as ColumnMap)[e]?.[f]?.col || (m.column_map as ColumnMap)[e]?.[f]?.default);
  for (const e of mapped) for (const f of FIELDS[e as Entity]) if (f.required && !has(e as Entity, f.field)) return false;
  if (!mapped.has("lines")) return true;
  const money = has("lines", "debit") || has("lines", "credit") || has("lines", "amount");
  const dated = mapped.has("entries") || has("lines", "date");
  return money && dated;
}

/**
 * Accounting → Migration → one migration: the twelve stages with a stepper, the numbers that matter at the top,
 * and the chosen stage below. Super Admin only.
 */
export default async function MigrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ stage?: string; table?: string; show?: string; kind?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "accounting.view");
  if (!viewer.isSuperAdmin) notFound();
  const m = await getMigration(id);
  if (!m) notFound();
  const sp = await searchParams;
  const t = await getTranslations("migration");
  const format = await getFormatter();
  const lang = await getLocale();
  const n = (x: number) => format.number(Number(x));
  const money = (x: number) => format.number(Number(x), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (s: string | null) => (s ? format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" }) : "—");

  const [tables, counts, targets] = await Promise.all([migrationTables(id), itemCounts(id), mappingTargets()]);
  const sourceRecords = tables.reduce((s, x) => s + x.row_count, 0);
  const sum = (status: string) => ["account", "entry", "owner", "land", "bill", "payment"].reduce((n, e) => n + (counts[`${e}:${status}`] ?? 0), 0);
  const ready = sum("ready");
  const migrated = sum("migrated");
  const failed = sum("failed") + sum("error");
  const skipped = sum("skipped");
  const totalItems = ready + migrated + failed + skipped;
  const progress = totalItems - skipped > 0 ? Math.round((migrated / (totalItems - skipped)) * 100) : 0;
  const done = m.status === "migrated";
  const tested = (m.status === "tested" || done) && m.test_prepared_at !== null && m.test_prepared_at === m.prepared_at;
  const stageDone: Record<Stage, boolean> = {
    prepare: m.source_files.length > 0,
    backups: m.source_backup_ok && m.target_backup_ok,
    inspectOld: tables.length > 0,
    inspectNew: true,
    tables: Object.values(m.table_map).some((x) => x === "lines" || x === "land"),
    columns: columnsDone(m),
    ids: m.prepared_at !== null && (counts["account:error"] ?? 0) === 0,
    preview: m.prepared_at !== null,
    test: tested,
    historical: tested,
    production: done,
    report: done,
  };
  const stageNo = Math.min(Math.max(Number(sp.stage) || STAGES.findIndex((s) => !stageDone[s]) + 1 || 12, 1), 12);
  const stage = STAGES[stageNo - 1]!;
  const href = (no: number, extra = "") => `/accounting/migration/${id}?stage=${no}${extra}`;
  const name = (x: { name_so: string; name_en: string }) => (lang === "so" ? x.name_so : x.name_en);

  // The old rows mapped so far (for the column samples and the ID mapping).
  const mappedTables = Object.entries(m.table_map as Record<string, TableTarget>).filter(([, x]) => x !== "ignore");
  const needRows = stage === "ids";
  const rows = needRows ? await migrationRows(id, mappedTables.map(([x]) => x)) : {};
  const live = needRows
    ? prepare({
        tables: rows,
        tableMap: m.table_map as Record<string, TableTarget>,
        columnMap: m.column_map as ColumnMap,
        accountMap: m.account_map as AccountMap,
        ourAccounts: targets.accounts.map((a) => a.code),
        neighbourhoodMap: m.neighbourhood_map,
        gradeMap: m.grade_map,
        feeMap: m.fee_map,
        ourGrades: targets.grades.map((g) => g.code),
        ourFees: targets.fees.map((f) => f.code),
      })
    : null;

  const runBlock = (r: RunResult | null, title: string) =>
    r && (
      <div className="space-y-3">
        <p className="text-sm font-semibold">{title}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["accountsCreated", r.accounts_created],
              ["accountsMapped", r.accounts_mapped],
              ["entriesPosted", r.entries],
              ["failedCount", r.failed],
              ["skippedCount", r.skipped],
              ["debitTotal", money(r.debit)],
              ["creditTotal", money(r.credit)],
              ["monthsLocked", r.locked_months.length],
              ...((r.land ?? 0) + (r.owners_created ?? 0) > 0
                ? ([
                    ["ownersCreated", (r.owners_created ?? 0) + (r.owners_matched ?? 0)],
                    ["landIn", r.land ?? 0],
                    ["billsIn", r.bills ?? 0],
                    ["paymentsIn", r.payments ?? 0],
                    ["demolishedIn", r.demolished ?? 0],
                    ["toCheckIn", r.to_check ?? 0],
                  ] as const)
                : []),
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-md border px-3 py-2">
              <dt className="text-muted-foreground text-xs">{t(`result.${k}`)}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {r.failures.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("record")}</TableHead>
                  <TableHead>{t("why")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.failures.map((f) => (
                  <TableRow key={`${f.entity}-${f.key}`}>
                    <TableCell className="text-sm">
                      {t(`entity.${f.entity}`)} <Mono>{f.key}</Mono>
                    </TableCell>
                    <TableCell className="text-danger text-sm">{f.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );

  let body: React.ReactNode = null;
  if (stage === "prepare") {
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t(`help.prepare`)}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("file")}</TableHead>
              <TableHead className="text-end">{t("size")}</TableHead>
              <TableHead>{t("fingerprint")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.source_files.map((f) => (
              <TableRow key={f.path}>
                <TableCell>{f.name}</TableCell>
                <TableCell className="text-end tabular-nums">{format.number(f.bytes / 1024 / 1024, { maximumFractionDigits: 2 })} MB</TableCell>
                <TableCell>
                  <Mono className="text-xs">{f.sha256.slice(0, 16)}…</Mono>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p>
          {t("sourceIs", { kind: t(`kinds.${m.source_kind}`), tables: tables.length, rows: n(sourceRecords) })} · {t("destinationIs")}
        </p>
        <Alert tone="info" title={t("noLiveConnection")}>
          {t("noLiveConnectionBody")}
        </Alert>
      </div>
    );
  } else if (stage === "backups") {
    const backups = await migrationBackups(id);
    body = (
      <div className="space-y-5 text-sm">
        <p className="text-muted-foreground">{t("help.backups")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-md border p-4">
            <p className="font-semibold">{t("sourceBackup")}</p>
            <p className="text-muted-foreground text-xs">{t("sourceBackupBody")}</p>
            <p>
              {when(m.source_backup_at)} ·{" "}
              <span className={m.source_backup_ok ? "text-status-approved" : "text-danger"}>{m.source_backup_ok ? t("checkedOk") : t("checkFailed")}</span>
            </p>
          </div>
          <div className="space-y-2 rounded-md border p-4">
            <p className="font-semibold">{t("targetBackup")}</p>
            <p className="text-muted-foreground text-xs">{t("targetBackupBody")}</p>
            {m.target_backup_at ? (
              <>
                <p>
                  {when(m.target_backup_at)} ·{" "}
                  <span className={m.target_backup_ok ? "text-status-approved" : "text-danger"}>{m.target_backup_ok ? t("checkedOk") : t("checkFailed")}</span>
                </p>
                <ul className="text-muted-foreground text-xs">
                  {backups.map((b) => (
                    <li key={b.table_name}>
                      <Mono>{b.table_name}</Mono>: {t("rowsCount", { count: b.row_count })}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-danger">{t("noBackupYet")}</p>
            )}
            {!done && <StepButton id={id} kind="backup" variant={m.target_backup_ok ? "outline" : "default"} />}
          </div>
        </div>
      </div>
    );
  } else if (stage === "inspectOld") {
    const open = tables.find((x) => x.name === sp.table) ?? tables[0];
    const sample = open ? await sampleRows(id, open.name, 8) : [];
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("help.inspectOld")}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table")}</TableHead>
              <TableHead className="text-end">{t("rows")}</TableHead>
              <TableHead className="text-end">{t("columns")}</TableHead>
              <TableHead>{t("primaryKey")}</TableHead>
              <TableHead>{t("links")}</TableHead>
              <TableHead className="text-end">{t("duplicates")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tables.map((x) => (
              <TableRow key={x.name} className={x.name === open?.name ? "bg-muted/40" : ""}>
                <TableCell>
                  <Link href={href(3, `&table=${encodeURIComponent(x.name)}`)} className="hover:text-primary">
                    <Mono className="font-medium">{x.name}</Mono>
                  </Link>
                </TableCell>
                <TableCell className="text-end tabular-nums">{n(x.row_count)}</TableCell>
                <TableCell className="text-end tabular-nums">{x.columns.length}</TableCell>
                <TableCell>
                  <Mono className="text-xs">{x.primary_key.join(", ") || "—"}</Mono>
                </TableCell>
                <TableCell className="text-xs">{x.foreign_keys.map((f) => `${f.columns.join(",")} → ${f.ref_table}`).join("; ") || "—"}</TableCell>
                <TableCell className={`text-end tabular-nums ${x.stats.duplicates ? "text-danger font-medium" : ""}`}>{x.stats.duplicates}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {open && (
          <div className="space-y-3">
            <p className="font-semibold">
              <Mono>{open.name}</Mono>
              {open.indexes.length > 0 && (
                <span className="text-muted-foreground ms-2 text-xs font-normal">
                  {t("indexes")}: {open.indexes.map((i) => `${i.unique ? "UNIQUE " : ""}${i.name || "—"}(${i.columns.join(",")})`).join(", ")}
                </span>
              )}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column")}</TableHead>
                  <TableHead>{t("dataType")}</TableHead>
                  <TableHead>{t("canBeEmpty")}</TableHead>
                  <TableHead>{t("defaultValue")}</TableHead>
                  <TableHead className="text-end">{t("emptyValues")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.columns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell>
                      <Mono>{c.name}</Mono>
                      {open.primary_key.includes(c.name) && <span className="text-flag ms-2 text-xs">PK</span>}
                    </TableCell>
                    <TableCell className="text-xs">{c.type || "—"}</TableCell>
                    <TableCell className="text-xs">{c.nullable ? t("yes") : t("no")}</TableCell>
                    <TableCell className="text-xs">{c.default ?? "—"}</TableCell>
                    <TableCell className={`text-end text-xs tabular-nums ${open.stats.nulls[c.name] ? "text-status-pending" : ""}`}>{open.stats.nulls[c.name] ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sample.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {open.columns.map((c) => (
                        <th key={c.name} className="px-2 py-1.5 text-start font-medium">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sample.map((r, i) => (
                      <tr key={i}>
                        {open.columns.map((c) => (
                          <td key={c.name} className="max-w-48 truncate px-2 py-1.5 font-mono">
                            {r[c.name] === null || r[c.name] === undefined ? "∅" : String(r[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  } else if (stage === "inspectNew") {
    const schema = await targetSchema();
    body = (
      <div className="space-y-5 text-sm">
        <p className="text-muted-foreground">{t("help.inspectNew")}</p>
        {schema.map((x) => (
          <div key={x.table} className="space-y-2">
            <p className="font-semibold">
              <Mono>{x.table}</Mono> <span className="text-muted-foreground text-xs font-normal">{t("rowsCount", { count: Math.max(Number(x.rows), 0) })}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {x.columns.map((c) => (
                <span key={c.name} className={cn("rounded border px-2 py-0.5 font-mono text-[11px]", c.required ? "border-primary/40 text-foreground" : "text-muted-foreground")}>
                  {c.name}: {c.type}
                  {c.required ? " *" : ""}
                </span>
              ))}
            </div>
            <ul className="text-muted-foreground space-y-0.5 text-[11px]">
              {x.constraints.map((c) => (
                <li key={c.name}>
                  <Mono>{c.name}</Mono> {c.def}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">{t("requiredMark")}</p>
      </div>
    );
  } else if (stage === "tables") {
    body = (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("help.tables")}</p>
        <TableMapping
          id={id}
          tables={tables.map((x) => ({ name: x.name, rows: x.row_count, columns: x.columns.length }))}
          value={m.table_map}
          suggested={Object.fromEntries(tables.map((x) => [x.name, suggestTable(x.name, x.columns.map((c) => c.name))]))}
          locked={done}
        />
      </div>
    );
  } else if (stage === "columns") {
    const entities = ENTITIES.map((e) => ({
      entity: e,
      tables: mappedTables.filter(([, x]) => x === e).map(([x]) => x),
    })).filter((e) => e.tables.length > 0);
    const samples: Partial<Record<Entity, Awaited<ReturnType<typeof sampleRows>>>> = {};
    for (const e of entities) samples[e.entity] = (await Promise.all(e.tables.map((x) => sampleRows(id, x, 3)))).flat();
    body = (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("help.columns")}</p>
        {entities.length === 0 ? (
          <Alert tone="warning" title={t("mapTablesFirst")} />
        ) : (
          <ColumnMapping
            id={id}
            entities={entities.map((e) => ({
              entity: e.entity,
              columns: [...new Set(tables.filter((x) => e.tables.includes(x.name)).flatMap((x) => x.columns.map((c) => c.name)))],
            }))}
            value={m.column_map}
            samples={samples}
            locked={done}
          />
        )}
      </div>
    );
  } else if (stage === "ids") {
    // Property values: suggest ours where an old value is our code or name; show the names of those already chosen.
    const vk = live?.valueKeys ?? { neighbourhoods: [], grades: [], fees: [] };
    const nKeys = vk.neighbourhoods.map((k) => k.key);
    const nIds = Object.values(m.neighbourhood_map).filter(Boolean);
    type Nb = { id: string; code: string; name_so: string; name_en: string; sector: { section: { district: { code: string } | null } | null } | null };
    const nbs: Nb[] = [];
    if (nKeys.length || nIds.length) {
      const supabase = await createClient();
      const cols = "id, code, name_so, name_en, sector:sectors(section:sections(district:districts(code)))";
      const found = await Promise.all([
        nIds.length ? supabase.from("neighbourhoods").select(cols).in("id", nIds) : null,
        nKeys.length ? supabase.from("neighbourhoods").select(cols).in("code", [...nKeys, ...nKeys.map((k) => k.toUpperCase())]) : null,
        nKeys.length ? supabase.from("neighbourhoods").select(cols).in("name_en", nKeys) : null,
        nKeys.length ? supabase.from("neighbourhoods").select(cols).in("name_so", nKeys) : null,
      ]);
      for (const f of found) nbs.push(...(((f?.data ?? []) as unknown) as Nb[]));
    }
    const nLabel = Object.fromEntries(nbs.map((n) => [n.id, { label: name(n), hint: [n.sector?.section?.district?.code, n.code].filter(Boolean).join("-") }]));
    const lower = (x: string) => x.trim().toLowerCase();
    const nSuggest = Object.fromEntries(
      nKeys.map((k) => [k, m.neighbourhood_map[k] ?? nbs.find((n) => [n.code, n.name_en, n.name_so].some((v) => lower(v) === lower(k)))?.id ?? ""]),
    );
    const gSuggest = Object.fromEntries(
      vk.grades.map((k) => [k.key, m.grade_map[k.key] ?? targets.grades.find((g) => [g.code, g.name_en, g.name_so].some((v) => lower(v) === lower(k.key)))?.code ?? ""]),
    );
    const fSuggest = Object.fromEntries(
      vk.fees.map((k) => [
        k.key,
        m.fee_map[k.key] ??
          targets.fees.find((f) => [f.code, f.name_en, f.name_so].some((v) => lower(v) === lower(k.key)))?.code ??
          (/service/i.test(k.key) ? "service_charge" : /tax|property|bill|canshuur/i.test(k.key) ? "property_bill" : ""),
      ]),
    );
    const hasBooks = (live?.accountKeys.length ?? 0) > 0;
    body = (
      <div className="space-y-6">
        <p className="text-muted-foreground text-sm">{t("help.ids")}</p>
        {!live || (!hasBooks && vk.neighbourhoods.length + vk.grades.length + vk.fees.length === 0) ? (
          <Alert tone="warning" title={t("mapColumnsFirst")} />
        ) : (
          <>
            {hasBooks && (
              <IdMapping
                id={id}
                accountKeys={live.accountKeys}
                accountMap={m.account_map}
                ours={targets.accounts.map((a) => ({ code: a.code, name: name(a) }))}
                districtKeys={live.districtKeys}
                districtMap={m.district_map}
                districts={targets.districts.map((d) => ({ id: d.id, code: d.code, name: name(d) }))}
                locked={done}
              />
            )}
            <PropertyMapping
              id={id}
              valueKeys={vk}
              neighbourhoodMap={nSuggest}
              gradeMap={gSuggest}
              feeMap={fSuggest}
              neighbourhoodLabels={nLabel}
              grades={targets.grades.map((g) => ({ code: g.code, name: name(g) }))}
              fees={targets.fees.map((f) => ({ code: f.code, name: name(f) }))}
              locked={done}
            />
          </>
        )}
      </div>
    );
  } else if (stage === "preview") {
    const show = (ITEM_STATUSES as readonly string[]).includes(sp.show ?? "") ? (sp.show as MigrationItem["status"]) : null;
    const kind = (["account", "entry", "owner", "land", "bill", "payment"] as const).find((k) => k === sp.kind) ?? null;
    const items = m.prepared_at ? await migrationItems(id, show, kind) : [];
    const s = m.prepared_summary;
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("help.preview")}</p>
        <div className="flex flex-wrap items-center gap-3">
          {!done && <StepButton id={id} kind="prepare" variant={m.prepared_at ? "outline" : "default"} />}
          {m.prepared_at && <span className="text-muted-foreground text-xs">{t("workedOutAt", { when: when(m.prepared_at) })}</span>}
        </div>
        {s && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("accountsReady")}</dt>
                <dd className="font-semibold tabular-nums">
                  {s.accounts.ready ?? 0} / {Object.values(s.accounts).reduce((a, b) => a + b, 0)}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("entriesReady")}</dt>
                <dd className="font-semibold tabular-nums">
                  {s.entries.ready ?? 0} / {Object.values(s.entries).reduce((a, b) => a + b, 0)}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("linesRead")}</dt>
                <dd className="font-semibold tabular-nums">{n(s.lines)}</dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("readyTotals")}</dt>
                <dd className="font-semibold tabular-nums">
                  {money(s.debit)} / {money(s.credit)}
                </dd>
              </div>
            </dl>
            {(["owners", "land", "bills", "payments"] as const).some((k) => Object.keys(s[k] ?? {}).length > 0) && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["owners", "land", "bills", "payments"] as const).map((k) => (
                  <div key={k} className="rounded-md border px-3 py-2">
                    <dt className="text-muted-foreground text-xs">{t(`readyOf.${k}`)}</dt>
                    <dd className="font-semibold tabular-nums">
                      {s[k]?.ready ?? 0} / {Object.values(s[k] ?? {}).reduce((a, b) => a + b, 0)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {(s.warnings ?? []).map((w) => (
              <Alert key={w} tone="warning" title={w} />
            ))}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[null, ...ITEM_STATUSES].map((x) => (
                <Link
                  key={x ?? "all"}
                  href={href(8, `${x ? `&show=${x}` : ""}${kind ? `&kind=${kind}` : ""}`)}
                  className={`rounded-full border px-3 py-1 ${show === x ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted"}`}
                >
                  {x ? t(`itemStatus.${x}`) : t("all")}
                </Link>
              ))}
              <span className="mx-1" />
              {[null, "account", "entry", "owner", "land", "bill", "payment"].map((x) => (
                <Link
                  key={x ?? "both"}
                  href={href(8, `${show ? `&show=${show}` : ""}${x ? `&kind=${x}` : ""}`)}
                  className={`rounded-full border px-3 py-1 ${kind === x ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted"}`}
                >
                  {x ? t(`entity.${x}`) : t("allKinds")}
                </Link>
              ))}
            </div>
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("record")}</TableHead>
                    <TableHead>{t("comesOut")}</TableHead>
                    <TableHead>{t("statusLabel")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => {
                    const d = i.data as {
                      code?: string;
                      create?: boolean;
                      name_en?: string;
                      date?: string;
                      memo?: string;
                      lines?: { account_key: string; debit: number; credit: number }[];
                      full_name?: string;
                      phone?: string;
                      house_no?: string;
                      legacy_pun?: string;
                      lat?: number | null;
                      demolished?: boolean;
                      year?: number;
                      amount?: number;
                      fee_code?: string;
                      land_key?: string;
                      bill_key?: string;
                      method?: string;
                    };
                    const other =
                      i.entity === "owner"
                        ? [d.full_name, d.phone].filter(Boolean).join(" · ")
                        : i.entity === "land"
                          ? [d.house_no && t("houseShort", { no: d.house_no }), d.legacy_pun && t("oldNo", { no: d.legacy_pun }), d.lat == null ? t("toCheck") : null, d.demolished ? t("demolishedShort") : null]
                              .filter(Boolean)
                              .join(" · ")
                          : i.entity === "bill"
                            ? [d.year, d.fee_code, d.amount !== undefined ? money(d.amount) : null, d.land_key && t("forLand", { key: d.land_key })].filter(Boolean).join(" · ")
                            : i.entity === "payment"
                              ? [d.date, d.amount !== undefined ? money(d.amount) : null, d.method, d.bill_key ? t("forBill", { key: d.bill_key }) : d.land_key && t("forLand", { key: d.land_key })]
                                  .filter(Boolean)
                                  .join(" · ")
                              : null;
                    return (
                      <TableRow key={`${i.entity}-${i.source_key}`} className="align-top">
                        <TableCell className="text-sm">
                          {t(`entity.${i.entity}`)} <Mono>{i.source_key}</Mono>
                        </TableCell>
                        <TableCell className="text-xs">
                          {other !== null ? (
                            <span>{other}</span>
                          ) : i.entity === "account" ? (
                            <span>
                              {d.code ?? "—"} {d.create ? `(${t("createNew")}) ${d.name_en ?? ""}` : ""}
                            </span>
                          ) : (
                            <span>
                              {d.date ?? "—"} · {d.memo ?? ""}
                              {(d.lines ?? []).slice(0, 4).map((l, k) => (
                                <span key={k} className="text-muted-foreground block font-mono">
                                  {l.account_key}: {l.debit ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}
                                </span>
                              ))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={i.status === "ready" || i.status === "migrated" ? "text-status-approved" : i.status === "skipped" ? "text-muted-foreground" : "text-danger"}>
                            {t(`itemStatus.${i.status}`)}
                          </span>
                          {i.message && <span className="text-danger block">{i.message}</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {items.length >= 300 && <p className="text-muted-foreground text-xs">{t("first300")}</p>}
          </>
        )}
      </div>
    );
  } else if (stage === "test") {
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("help.test")}</p>
        {!m.prepared_at ? (
          <Alert tone="warning" title={t("previewFirst")} />
        ) : (
          !done && <StepButton id={id} kind="test" variant={tested ? "outline" : "default"} />
        )}
        {m.test_at && !tested && !done && <Alert tone="warning" title={t("testOutOfDate")} />}
        {runBlock(m.test_result, t("testResult", { when: when(m.test_at) }))}
      </div>
    );
  } else if (stage === "historical") {
    const entries = m.prepared_at ? await migrationItems(id, "ready", "entry", 100_000) : [];
    const years = new Map<string, { count: number; debit: number }>();
    for (const e of entries) {
      const d = e.data as { date?: string; lines?: { debit: number }[] };
      const y = (d.date ?? "").slice(0, 4) || "—";
      const cur = years.get(y) ?? { count: 0, debit: 0 };
      cur.count += 1;
      cur.debit += (d.lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
      years.set(y, cur);
    }
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("help.historical")}</p>
        <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-xs">
          <li>{t("historicalRule1")}</li>
          <li>{t("historicalRule2")}</li>
          <li>{t("historicalRule3")}</li>
          <li>{t("historicalRule4")}</li>
        </ul>
        {years.size > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("year")}</TableHead>
                <TableHead className="text-end">{t("entriesCol")}</TableHead>
                <TableHead className="text-end">{t("debitTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...years.entries()].sort().map(([y, v]) => (
                <TableRow key={y}>
                  <TableCell>{y}</TableCell>
                  <TableCell className="text-end tabular-nums">{n(v.count)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(v.debit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <MigrationOptions id={id} lockMonths={Boolean(m.options.lock_months)} locked={done} />
      </div>
    );
  } else if (stage === "production") {
    const checks = [
      { ok: m.target_backup_ok, label: t("checkBackup") },
      { ok: m.prepared_at !== null, label: t("checkPreview") },
      { ok: tested, label: t("checkTest") },
      { ok: ready > 0, label: t("checkReady", { count: ready }) },
    ];
    body = (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("help.production")}</p>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? "text-status-approved" : "text-danger"}>
              {c.ok ? "✓" : "✗"} {c.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {!done && <StepButton id={id} kind="run" disabled={!checks.every((c) => c.ok)} />}
          {done && <UndoMigration id={id} />}
        </div>
        {runBlock(m.run_result, t("runResult", { when: when(m.run_at) }))}
        {m.status === "undone" && <Alert tone="warning" title={t("wasUndone", { when: when(m.undone_at) })} />}
      </div>
    );
  } else {
    const [rep, log] = await Promise.all([migrationReport(id), migrationLog(id)]);
    const balanced = Math.abs(Number(rep.books_debit) - Number(rep.books_credit)) < 0.005;
    const matches = Math.abs(Number(rep.books_debit) - Number(m.run_result?.debit ?? 0)) < 0.005;
    body = (
      <div className="space-y-5 text-sm">
        <p className="text-muted-foreground">{t("help.report")}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["sourceRecords", n(rep.source_rows)],
              ["entriesInBooks", n(rep.books_entries)],
              ["booksDebit", money(rep.books_debit)],
              ["booksCredit", money(rep.books_credit)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-md border px-3 py-2">
              <dt className="text-muted-foreground text-xs">{t(`report.${k}`)}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {done && (
          <ul className="space-y-1">
            <li className={balanced ? "text-status-approved" : "text-danger"}>
              {balanced ? "✓" : "✗"} {t("verifyBalanced")}
            </li>
            <li className={matches ? "text-status-approved" : "text-danger"}>
              {matches ? "✓" : "✗"} {t("verifyMatches")}
            </li>
            <li className={(rep.items["entry:failed"] ?? 0) === 0 ? "text-status-approved" : "text-status-pending"}>
              {t("verifyFailed", { count: (rep.items["entry:failed"] ?? 0) + (rep.items["account:failed"] ?? 0) })}
            </li>
          </ul>
        )}
        {rep.trial.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold">{t("trialOfMigrated")}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("account")}</TableHead>
                  <TableHead className="text-end">{t("debitTotal")}</TableHead>
                  <TableHead className="text-end">{t("creditTotal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rep.trial.map((r) => (
                  <TableRow key={r.account}>
                    <TableCell>
                      <Link href={`/accounting?tab=ledger&account=${r.account}`} className="hover:text-primary">
                        <Mono>{r.account}</Mono> {name(r)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{money(r.debit)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(r.credit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="space-y-2">
          <p className="font-semibold">{t("logTitle")}</p>
          <ul className="divide-y rounded-md border text-xs">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="text-muted-foreground tabular-nums">{when(l.at)}</span>
                <span className="font-medium">{t.has(`stages.${l.stage}`) ? t(`stages.${l.stage}`) : l.stage}</span>
                <span className="text-muted-foreground min-w-0 flex-1 break-words">{l.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const stat = (label: string, value: string | number, tone = "") => (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/accounting/migration" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft className="size-4" aria-hidden />
        {t("allMigrations")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {m.name}
            <StatusBadge tone={MIGRATION_TONE[m.status]}>{t(`status.${m.status}`)}</StatusBadge>
          </span>
        }
        description={t("subtitle")}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {stat(t("stats.source"), n(sourceRecords))}
        {stat(t("stats.target"), n(targets.journalEntries))}
        {stat(t("stats.ready"), n(ready))}
        {stat(t("stats.migrated"), n(migrated), "text-status-approved")}
        {stat(t("stats.failed"), n(failed), failed ? "text-danger" : "")}
        {stat(t("stats.skipped"), n(skipped))}
        {stat(t("stats.progress"), `${progress}%`)}
        {stat(t("stats.status"), t(`status.${m.status}`))}
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* The stepper: every stage, done or not; the open one is marked. */}
        <nav aria-label={t("stagesTitle")} className="h-fit">
          <ol className="space-y-1">
            {STAGES.map((s, i) => (
              <li key={s}>
                <Link
                  href={href(i + 1)}
                  aria-current={stage === s ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    stage === s ? "bg-primary/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                      stageDone[s] ? "bg-status-approved border-status-approved text-white" : stage === s ? "border-primary text-primary" : "",
                    )}
                  >
                    {stageDone[s] ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  {t(`stages.${s}`)}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {stageNo}. {t(`stages.${stage}`)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {body}
            <div className="flex justify-between border-t pt-4 text-sm">
              {stageNo > 1 ? (
                <Link href={href(stageNo - 1)} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <ChevronLeft className="size-4" aria-hidden />
                  {t(`stages.${STAGES[stageNo - 2]!}`)}
                </Link>
              ) : (
                <span />
              )}
              {stageNo < 12 && (
                <Link href={href(stageNo + 1)} className="text-primary inline-flex items-center gap-1 font-medium">
                  {t(`stages.${STAGES[stageNo]!}`)}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
