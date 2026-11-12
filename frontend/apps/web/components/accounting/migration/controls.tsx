"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { DatabaseBackup, FlaskConical, Play, RefreshCw, Undo2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  backupMigrationAction,
  prepareMigrationAction,
  runMigrationAction,
  saveMigrationAction,
  testMigrationAction,
  undoMigrationAction,
} from "@/app/[locale]/(staff)/accounting/migration/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import { FIELDS, fieldValue, type AccountMap, type ColumnMap, type DateFormat, type Entity, type FieldMap, type GlType, type TableTarget, type Transform } from "@/lib/migration/prepare";
import type { Row } from "@/lib/migration/source";

/** Stage 1: name the migration and upload the old file(s). */
export function UploadMigration() {
  const t = useTranslations("migration");
  const router = useRouter();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setProblem(null);
    const body = new FormData();
    body.set("name", name);
    for (const f of files) body.append("files", f);
    const res = await fetch("/api/accounting-migration/upload", { method: "POST", body }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !out?.id) {
      const code = out?.error ?? "failed";
      return setProblem(t.has(`uploadErrors.${code}`) ? t(`uploadErrors.${code}`) : t("uploadErrors.failed"));
    }
    router.push(`/accounting/migration/${out.id}`);
  };
  return (
    <div className="space-y-4">
      {problem && <Alert tone="danger" title={problem} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="mig-name" label={t("name")} hint={t("nameHint")} required>
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
        </Field>
        <Field id="mig-files" label={t("files")} hint={t("filesHint")} required>
          <Input type="file" multiple accept=".sql,.csv,.txt" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button loading={busy} disabled={name.trim().length < 2 || files.length === 0} onClick={send}>
          <Upload aria-hidden />
          {t("upload")}
        </Button>
      </div>
    </div>
  );
}

type StepKind = "backup" | "prepare" | "test" | "run";
const STEP_ICON = { backup: DatabaseBackup, prepare: RefreshCw, test: FlaskConical, run: Play };

/** A stage's one button (back up the books, work out the preview, test, migrate); the real run asks first. */
export function StepButton({ id, kind, disabled, variant }: { id: string; kind: StepKind; disabled?: boolean; variant?: "outline" | "default" }) {
  const t = useTranslations("migration");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const Icon = STEP_ICON[kind];
  const go = async () => {
    setBusy(true);
    const fn = { backup: backupMigrationAction, prepare: prepareMigrationAction, test: testMigrationAction, run: runMigrationAction }[kind];
    const res = await fn({ id });
    setBusy(false);
    setAsking(false);
    if (!res.ok) return toast.error(errorMessage(res.error));
    toast.success(t(`done.${kind}`));
    router.refresh();
  };
  return (
    <>
      <Button variant={variant} loading={busy && !asking} disabled={disabled} onClick={() => (kind === "run" ? setAsking(true) : void go())}>
        <Icon aria-hidden />
        {t(`buttons.${kind}`)}
      </Button>
      {kind === "run" && (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={t("runConfirmTitle")}
          description={t("runConfirmBody")}
          confirmLabel={t("buttons.run")}
          loading={busy}
          onConfirm={() => void go()}
        />
      )}
    </>
  );
}

/** Take a run back out of the books, with a reason. */
export function UndoMigration({ id }: { id: string }) {
  const t = useTranslations("migration");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className="text-danger" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden />
        {t("buttons.undo")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("undoTitle")}
        description={t("undoBody")}
        confirmLabel={t("buttons.undo")}
        destructive
        successMessage={t("done.undo")}
        submit={() => undoMigrationAction({ id, reason })}
      >
        {(fe) => (
          <Field id="undo-reason" label={t("reason")} error={fe("reason")} required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

function useSave(id: string) {
  const t = useTranslations("migration");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Omit<Parameters<typeof saveMigrationAction>[0], "id">) => {
    setBusy(true);
    const res = await saveMigrationAction({ id, ...patch });
    setBusy(false);
    if (!res.ok) return toast.error(errorMessage(res.error));
    toast.success(t("saved"));
    router.refresh();
  };
  return { busy, save };
}

/** Stage 5: what each old table holds. */
export function TableMapping({
  id,
  tables,
  value,
  suggested,
  locked,
}: {
  id: string;
  tables: { name: string; rows: number; columns: number }[];
  value: Record<string, TableTarget>;
  suggested: Record<string, TableTarget>;
  locked: boolean;
}) {
  const t = useTranslations("migration");
  const [map, setMap] = useState<Record<string, TableTarget>>(() => Object.fromEntries(tables.map((x) => [x.name, value[x.name] ?? "ignore"])));
  const [q, setQ] = useState("");
  const { busy, save } = useSave(id);
  const shown = tables.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchTables")} className="max-w-xs" />
      <div className="divide-y rounded-md border">
        {shown.map((x) => (
          <div key={x.name} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <Mono className="font-medium">{x.name}</Mono>
              <span className="text-muted-foreground block text-xs">{t("tableSize", { rows: x.rows, columns: x.columns })}</span>
            </span>
            <span className="text-muted-foreground text-xs">→</span>
            <NativeSelect className="w-52" value={map[x.name]} disabled={locked} onChange={(e) => setMap({ ...map, [x.name]: e.target.value as TableTarget })}>
              {(["accounts", "entries", "lines", "ignore"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`targets.${k}`)}
                  {suggested[x.name] === k && k !== "ignore" ? ` (${t("suggested")})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      {!locked && (
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save({ tableMap: map })}>
            {t("saveMapping")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Stage 6: which old column fills each of our fields, and how it is changed on the way. */
export function ColumnMapping({
  id,
  entities,
  value,
  samples,
  locked,
}: {
  id: string;
  /** The entities with old tables mapped to them, and those tables' columns. */
  entities: { entity: Entity; columns: string[] }[];
  value: ColumnMap;
  /** A few old rows of each entity's tables, to show what comes out. */
  samples: Partial<Record<Entity, Row[]>>;
  locked: boolean;
}) {
  const t = useTranslations("migration");
  const [map, setMap] = useState<ColumnMap>(value);
  const { busy, save } = useSave(id);
  const set = (e: Entity, f: string, patch: Partial<FieldMap>) =>
    setMap((m) => ({ ...m, [e]: { ...(m[e] ?? {}), [f]: { ...(m[e]?.[f] ?? { col: null }), ...patch } } }));
  return (
    <div className="space-y-6">
      {entities.map(({ entity, columns }) => (
        <section key={entity} className="space-y-2">
          <p className="text-sm font-semibold">{t(`targets.${entity}`)}</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("ourField")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("oldColumn")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("transform")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("defaultValue")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("comesOut")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {FIELDS[entity].map((f) => {
                  const m = map[entity]?.[f.field] ?? { col: null };
                  const rows = samples[entity] ?? [];
                  const out = rows.slice(0, 3).map((r) => fieldValue(r, m));
                  const bad = out.some((o) => o.bad);
                  return (
                    <tr key={f.field} className="align-top">
                      <td className="px-3 py-2">
                        <span className="font-medium">{t(`fields.${f.field}`)}</span>
                        {f.required && <span className="text-danger ms-0.5">*</span>}
                        <span className="text-muted-foreground block text-xs">{t(`fieldHints.${entity}.${f.field}`)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <NativeSelect className="w-44" value={m.col ?? ""} disabled={locked} onChange={(e) => set(entity, f.field, { col: e.target.value || null })}>
                          <option value="">{t("notMapped")}</option>
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                      <td className="space-y-1 px-3 py-2">
                        <NativeSelect className="w-36" value={m.transform ?? "none"} disabled={locked} onChange={(e) => set(entity, f.field, { transform: e.target.value as Transform })}>
                          {(["none", "trim", "upper", "lower", "number", "date"] as const).map((x) => (
                            <option key={x} value={x}>
                              {t(`transforms.${x}`)}
                            </option>
                          ))}
                        </NativeSelect>
                        {m.transform === "date" && (
                          <NativeSelect className="w-36" value={m.format ?? "auto"} disabled={locked} onChange={(e) => set(entity, f.field, { format: e.target.value as DateFormat })}>
                            {(["auto", "ymd", "dmy", "mdy", "unix"] as const).map((x) => (
                              <option key={x} value={x}>
                                {t(`formats.${x}`)}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                        {f.kind === "money" && m.transform === "number" && (
                          <Input
                            className="h-8 w-36"
                            type="number"
                            min={0}
                            step="any"
                            disabled={locked}
                            placeholder={t("factor")}
                            title={t("factorHint")}
                            value={m.factor ?? ""}
                            onChange={(e) => set(entity, f.field, { factor: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input className="h-8 w-32" value={m.default ?? ""} disabled={locked} onChange={(e) => set(entity, f.field, { default: e.target.value || undefined })} />
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs ${bad ? "text-danger" : "text-muted-foreground"}`}>
                        {out.length === 0 ? "—" : out.map((o, i) => <span key={i} className="block truncate">{o.bad ? `⚠ ${o.bad}` : o.value === null ? "∅" : String(o.value)}</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!locked && (
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save({ columnMap: map })}>
            {t("saveMapping")}
          </Button>
        </div>
      )}
    </div>
  );
}

const TYPES: GlType[] = ["asset", "liability", "equity", "income", "expense"];

/** Stage 7: each old account to one of ours (or a new one), and each old district value to one of ours. */
export function IdMapping({
  id,
  accountKeys,
  accountMap,
  ours,
  districtKeys,
  districtMap,
  districts,
  locked,
}: {
  id: string;
  accountKeys: { key: string; code: string | null; name: string | null; type: GlType | null; lines: number }[];
  accountMap: AccountMap;
  ours: { code: string; name: string }[];
  districtKeys: { key: string; lines: number }[];
  districtMap: Record<string, string>;
  districts: { id: string; code: string; name: string }[];
  locked: boolean;
}) {
  const t = useTranslations("migration");
  const ourCodes = useMemo(() => new Set(ours.map((o) => o.code)), [ours]);
  const start = () =>
    Object.fromEntries(
      accountKeys.map((a) => {
        const set = accountMap[a.key];
        if (set) return [a.key, set];
        const guess = [a.code, a.key].find((c) => c && /^\d{4}$/.test(c)) ?? "";
        return [a.key, { code: guess, create: Boolean(guess && !ourCodes.has(guess)), name_en: a.name ?? "", type: a.type ?? undefined }];
      }),
    ) as AccountMap;
  const [accts, setAccts] = useState<AccountMap>(start);
  const [dists, setDists] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      districtKeys.map((d) => {
        if (districtMap[d.key] !== undefined) return [d.key, districtMap[d.key]!];
        const k = d.key.trim().toLowerCase();
        return [d.key, districts.find((x) => x.code.toLowerCase() === k || x.name.toLowerCase() === k || x.id === d.key)?.id ?? ""];
      }),
    ),
  );
  const { busy, save } = useSave(id);
  const setA = (key: string, patch: Partial<AccountMap[string]>) => setAccts((m) => ({ ...m, [key]: { ...(m[key] ?? { code: "", create: false }), ...patch } }));
  const complete = Object.fromEntries(Object.entries(accts).filter(([, v]) => /^\d{4}$/.test(v.code))) as AccountMap;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-semibold">{t("accountIds")}</p>
        <p className="text-muted-foreground text-xs">{t("accountIdsHint")}</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("oldAccount")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("ourAccount")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("newAccount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accountKeys.map((a) => {
                const v = accts[a.key] ?? { code: "", create: false };
                return (
                  <tr key={a.key} className="align-top">
                    <td className="px-3 py-2">
                      <Mono className="font-medium">{a.key}</Mono>
                      {a.code && a.code !== a.key && <Mono className="text-muted-foreground ms-2 text-xs">{a.code}</Mono>}
                      <span className="text-muted-foreground block text-xs">
                        {[a.name, t("linesCount", { count: a.lines })].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <NativeSelect
                        className="w-64"
                        disabled={locked}
                        value={v.create ? "__new" : ourCodes.has(v.code) ? v.code : ""}
                        onChange={(e) => (e.target.value === "__new" ? setA(a.key, { create: true, code: ourCodes.has(v.code) ? "" : v.code }) : setA(a.key, { create: false, code: e.target.value }))}
                      >
                        <option value="">{t("chooseAccount")}</option>
                        {ours.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.code} · {o.name}
                          </option>
                        ))}
                        <option value="__new">{t("createNew")}</option>
                      </NativeSelect>
                    </td>
                    <td className="px-3 py-2">
                      {v.create && (
                        <div className="flex flex-wrap gap-2">
                          <Input className="h-8 w-20" inputMode="numeric" maxLength={4} placeholder="6900" disabled={locked} value={v.code} onChange={(e) => setA(a.key, { code: e.target.value.replace(/\D/g, "") })} />
                          <Input className="h-8 w-48" placeholder={t("accountName")} disabled={locked} value={v.name_en ?? ""} onChange={(e) => setA(a.key, { name_en: e.target.value })} />
                          <NativeSelect className="h-8 w-32" disabled={locked} value={v.type ?? ""} onChange={(e) => setA(a.key, { type: (e.target.value || undefined) as GlType | undefined })}>
                            <option value="">{t("accountType")}</option>
                            {TYPES.map((x) => (
                              <option key={x} value={x}>
                                {t(`glTypes.${x}`)}
                              </option>
                            ))}
                          </NativeSelect>
                          {ourCodes.has(v.code) && <span className="text-muted-foreground self-center text-xs">{t("codeExists")}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {districtKeys.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-semibold">{t("districtIds")}</p>
          <div className="divide-y rounded-md border">
            {districtKeys.map((d) => (
              <div key={d.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <Mono>{d.key}</Mono>
                  <span className="text-muted-foreground ms-2 text-xs">{t("linesCount", { count: d.lines })}</span>
                </span>
                <NativeSelect className="w-56" disabled={locked} value={dists[d.key] ?? ""} onChange={(e) => setDists({ ...dists, [d.key]: e.target.value })}>
                  <option value="">{t("noDistrict")}</option>
                  {districts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
        </section>
      )}
      {!locked && (
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save({ accountMap: complete, districtMap: dists })}>
            {t("saveMapping")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Stage 10: how the old entries are kept once migrated. */
export function MigrationOptions({ id, lockMonths, locked }: { id: string; lockMonths: boolean; locked: boolean }) {
  const t = useTranslations("migration");
  const [lock, setLock] = useState(lockMonths);
  const { busy, save } = useSave(id);
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <Switch checked={lock} disabled={locked} onCheckedChange={setLock} />
        <span>
          <span className="font-medium">{t("lockMonths")}</span>
          <span className="text-muted-foreground block text-xs">{t("lockMonthsHint")}</span>
        </span>
      </label>
      {!locked && (
        <div className="flex justify-end">
          <Button loading={busy} disabled={lock === lockMonths} onClick={() => void save({ options: { lock_months: lock } })}>
            {t("saveMapping")}
          </Button>
        </div>
      )}
    </div>
  );
}
