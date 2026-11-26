"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { CheckCircle2, Globe2, Loader2, Mail, MessageSquare, Search, Send, UserPlus, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ComposePreview,
  composePreviewAction,
  composeSendAction,
  type OwnerChoice,
  searchOwnersAction,
} from "@/app/[locale]/(staff)/messages/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import { PLACEHOLDERS, smsParts } from "@/lib/message-text";
import type { MessageCategory } from "@/lib/server/messages";
import { AreaPicker, type PickedArea } from "./area-picker";

const CATEGORIES: MessageCategory[] = ["tax_reminder", "tax_invoice", "payment_confirmation", "outstanding_tax", "general", "government", "custom"];
type Mode = "owners" | "areas" | "all";
type Channel = "sms" | "email";

/** The message with one owner's values filled in (the same rule the database uses). */
function fill(body: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [k, v]) => text.split(`{${k}}`).join(v ?? ""), body);
}
type Template = { code: string; body_so: string; body_en: string; category: MessageCategory };

/** Write a message to chosen owners or to every owner in chosen areas: check who gets it, then confirm. */
export function Compose({ templates, canSchedule = true }: { templates: Template[]; canSchedule?: boolean }) {
  const t = useTranslations("messages.compose");
  const locale = useLocale();
  const em = useErrorMessage();

  // 1. Who
  const [mode, setMode] = useState<Mode>("owners");
  const [channel, setChannel] = useState<Channel>("sms");
  const [template, setTemplate] = useState<string | null>(null);
  const [perParcel, setPerParcel] = useState(false);
  const [owners, setOwners] = useState<OwnerChoice[]>([]);
  const [areas, setAreas] = useState<PickedArea[]>([]);
  // 2. What
  const [category, setCategory] = useState<MessageCategory>("tax_reminder");
  const [lang, setLang] = useState<"so" | "en">(locale === "en" ? "en" : "so");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // 3. When
  const [later, setLater] = useState(false);
  const [at, setAt] = useState("");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  // 4. Check, 5. Send
  const [preview, setPreview] = useState<ComposePreview | null>(null);
  const [checkedKey, setCheckedKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState<{ id: string; number: string; queued: number; scheduled_at: string | null } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const target = useMemo(
    () =>
      mode === "all"
        ? { all: true, owners: [], districts: [], sections: [], sectors: [], neighbourhoods: [] }
        : mode === "owners"
          ? { all: false, owners: owners.map((o) => o.id), districts: [], sections: [], sectors: [], neighbourhoods: [] }
          : {
            all: false,
            owners: [],
            districts: areas.filter((a) => a.level === "district").map((a) => a.id),
            sections: areas.filter((a) => a.level === "section").map((a) => a.id),
            sectors: areas.filter((a) => a.level === "sector").map((a) => a.id),
            neighbourhoods: areas.filter((a) => a.level === "neighbourhood").map((a) => a.id),
          },
    [mode, owners, areas],
  );
  const hasTarget = mode === "all" || (mode === "owners" ? owners.length > 0 : areas.length > 0);
  // The check is for exactly these recipients: any change asks for a new check before sending. The message itself
  // can still be edited after the check; the preview follows it.
  const key = JSON.stringify({ target, lang, channel, allowDuplicates, perParcel });
  const fresh = preview !== null && checkedKey === key;
  const scheduledAt = later && at ? new Date(at).toISOString() : null;
  const sms = smsParts(body);
  const maxBody = channel === "email" ? 1000 : 640;
  const live = preview?.sample_vars && body ? fill(body, preview.sample_vars) : null;
  const where = !preview
    ? ""
    : preview.all
      ? t("everywhere")
      : preview.areas.length > 0
        ? preview.areas.map((a) => `${t(`levels.${a.level}`)} ${locale === "so" ? a.name_so : a.name_en}`).join(", ")
        : t("theChosen");

  const applyTemplate = (code: string) => {
    const tpl = templates.find((x) => x.code === code);
    if (!tpl) return;
    setBody(lang === "en" ? tpl.body_en : tpl.body_so);
    setCategory(tpl.category);
    setTemplate(tpl.code);
  };
  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next.slice(0, maxBody));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function check() {
    setChecking(true);
    setError(null);
    const r = await composePreviewAction({ target, lang, channel, body, allowDuplicates, perParcel });
    setChecking(false);
    if (r.ok) {
      setPreview(r.data);
      setCheckedKey(key);
      setShowAll(false);
    } else {
      setPreview(null);
      setError(r.error);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <div className="space-y-1">
            <p className="text-lg font-semibold">{sent.scheduled_at ? t("doneScheduled", { n: sent.queued }) : t("doneSent", { n: sent.queued })}</p>
            <p className="text-sm text-muted-foreground">{t("doneBody", { number: sent.number })}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href={`/messages/${sent.id}`}>{t("seeResults")}</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSent(null);
                setPreview(null);
                setOwners([]);
                setAreas([]);
                setBody("");
                setTitle("");
                setTemplate(null);
              }}
            >
              {t("writeAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        {/* 1. Who gets it */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Step n={1} />
              {t("whoTitle")}
            </CardTitle>
            <CardDescription>{t("whoHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={t("whoTitle")}>
              {(["owners", "areas", "all"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "owners" ? <UserPlus className="size-4" aria-hidden /> : m === "areas" ? <Users className="size-4" aria-hidden /> : <Globe2 className="size-4" aria-hidden />}
                  {t(`mode.${m}`)}
                </button>
              ))}
            </div>
            {mode === "owners" && <OwnerPicker value={owners} onChange={setOwners} />}
            {mode === "areas" && <AreaPicker value={areas} onChange={setAreas} />}
            {mode === "all" && <Alert tone="warning">{t("allHelp")}</Alert>}
          </CardContent>
        </Card>

        {/* 2. The message */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Step n={2} />
              {t("whatTitle")}
            </CardTitle>
            <CardDescription>{t("whatHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={t("channel")}>
              {(["sms", "email"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={channel === c}
                  onClick={() => setChannel(c)}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${channel === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {c === "sms" ? <MessageSquare className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
                  {t(`channels.${c}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="category" label={t("category")}>
                <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as MessageCategory)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="lang" label={t("language")}>
                <NativeSelect value={lang} onChange={(e) => setLang(e.target.value as "so" | "en")}>
                  <option value="so">Soomaali</option>
                  <option value="en">English</option>
                </NativeSelect>
              </Field>
              <Field id="template" label={t("template")}>
                <NativeSelect value="" onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">{t("templatePick")}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.code} value={tpl.code}>
                      {t(`categories.${tpl.category}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field id="title" label={channel === "email" ? t("subject") : t("titleLabel")} hint={channel === "email" ? t("subjectHint") : t("titleHint")}>
              <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="space-y-1.5">
              <Field id="body" label={t("body")} required>
                <Textarea ref={bodyRef} rows={channel === "email" ? 8 : 5} maxLength={maxBody} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("bodyPlaceholder")} />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                {channel === "sms" ? (
                  <span className={sms.parts > 3 ? "text-warning" : undefined}>
                    {t("counter", { n: sms.length, parts: sms.parts, per: sms.perPart })}
                    {sms.unicode && ` · ${t("unicode")}`}
                  </span>
                ) : (
                  <span>{t("emailCounter", { n: body.length, max: maxBody })}</span>
                )}
                <span>{t("counterHint")}</span>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">{t("placeholders")}</p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => insert(p)}
                    title={t(`placeholderHelp.${p}`)}
                    className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11.5px] hover:border-foreground/30 hover:bg-muted"
                  >
                    {`{${p}}`}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("placeholdersAlt")}</p>
            {live && (
              <div>
                <p className="label-caps mb-1 text-muted-foreground">{t("livePreview")}</p>
                <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{live}</p>
              </div>
            )}
            {!preview && body && <p className="text-xs text-muted-foreground">{t("livePreviewHint")}</p>}
          </CardContent>
        </Card>

        {/* 3. When */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Step n={3} />
              {t("optionsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="when" checked={!later} onChange={() => setLater(false)} />
                {t("now")}
              </label>
              {canSchedule && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" checked={later} onChange={() => setLater(true)} />
                  {t("later")}
                </label>
              )}
              {later && (
                <Input
                  type="datetime-local"
                  aria-label={t("later")}
                  className="w-56"
                  value={at}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={(e) => setAt(e.target.value)}
                />
              )}
            </div>
            <label className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={perParcel} onCheckedChange={(v) => setPerParcel(v === true)} />
              <span>
                {t("perParcel")}
                <span className="block text-xs text-muted-foreground">{t("perParcelHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={allowDuplicates} onCheckedChange={(v) => setAllowDuplicates(v === true)} />
              <span>
                {t("allowDuplicates")}
                <span className="block text-xs text-muted-foreground">{t("allowDuplicatesHint")}</span>
              </span>
            </label>
          </CardContent>
        </Card>
      </div>

      {/* 4. Check and send */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Step n={4} />
              {t("checkTitle")}
            </CardTitle>
            <CardDescription>{t("checkHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" variant={fresh ? "outline" : "default"} disabled={!hasTarget || checking} onClick={check}>
              {checking ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
              {fresh ? t("checkAgain") : t("check")}
            </Button>
            {error && <Alert tone="danger">{em(error)}</Alert>}
            {preview && !fresh && <Alert tone="warning">{t("changed")}</Alert>}
            {preview && (
              <div className={`space-y-4 ${fresh ? "" : "opacity-50"}`}>
                <p className="rounded-md bg-primary/5 px-3 py-2 text-sm font-medium">
                  {t(channel === "email" ? "summaryEmail" : "summary", { n: preview.valid, where })}
                </p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Tile label={t("owners")} value={preview.owners} />
                  {perParcel && <Tile label={t("messagesN")} value={preview.messages} />}
                  <Tile label={channel === "email" ? t("validEmail") : t("valid")} value={preview.valid} tone="success" />
                  <Tile label={channel === "email" ? t("missingEmail") : t("missing")} value={preview.missing} tone={preview.missing ? "warning" : undefined} />
                  <Tile label={channel === "email" ? t("invalidEmail") : t("invalid")} value={preview.invalid} tone={preview.invalid ? "danger" : undefined} />
                  <Tile label={channel === "email" ? t("duplicatesEmail") : t("duplicates")} value={preview.duplicates} tone={preview.duplicates ? "warning" : undefined} />
                </dl>
                {preview.areas.length > 0 && (
                  <div>
                    <p className="label-caps mb-1 text-muted-foreground">{t("areas")}</p>
                    <p className="text-sm">{preview.areas.map((a) => `${t(`levels.${a.level}`)} ${locale === "so" ? a.name_so : a.name_en}`).join(" · ")}</p>
                  </div>
                )}
                {live && (
                  <div>
                    <p className="label-caps mb-1 text-muted-foreground">{t("sample")}</p>
                    <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{live}</p>
                  </div>
                )}
                {preview.rows.length > 0 && (
                  <div>
                    <p className="label-caps mb-1 text-muted-foreground">{t("list")}</p>
                    <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-xs">
                      {(showAll ? preview.rows : preview.rows.slice(0, 8)).map((r) => (
                        <li key={`${r.party_id}${r.parcel_id ?? ""}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{r.name}</span>
                            <span className="font-mono text-muted-foreground">{r.address ?? "—"}</span>
                          </span>
                          <span className={r.state === "ok" ? "text-success" : r.state === "invalid" ? "text-danger" : "text-warning"}>
                            {channel === "email" ? t(`statesEmail.${r.state}`) : t(`states.${r.state}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {preview.rows.length > 8 && (
                      <Button variant="link" size="sm" className="px-0" onClick={() => setShowAll((s) => !s)}>
                        {showAll ? t("showLess") : t("showAll", { n: preview.rows.length })}
                      </Button>
                    )}
                    {preview.messages > preview.rows.length && <p className="text-xs text-muted-foreground">{t("listCut", { n: preview.rows.length })}</p>}
                  </div>
                )}
                <Button className="w-full" disabled={!fresh || preview.valid === 0 || body.trim().length < 2 || (later && !at)} onClick={() => setConfirm(true)}>
                  <Send aria-hidden />
                  {scheduledAt ? t("scheduleN", { n: preview.valid }) : t("sendN", { n: preview.valid })}
                </Button>
                {body.trim().length < 2 && <p className="text-xs text-muted-foreground">{t("writeFirst")}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={scheduledAt ? t("confirmScheduleTitle", { n: preview?.valid ?? 0 }) : t("confirmTitle", { n: preview?.valid ?? 0 })}
        description={`${t(channel === "email" ? "summaryEmail" : "summary", { n: preview?.valid ?? 0, where })} ${t("confirmBody", { skipped: (preview?.messages ?? 0) - (preview?.valid ?? 0) })}`}
        confirmLabel={scheduledAt ? t("confirmSchedule") : t("confirmSend")}
        submit={() =>
          composeSendAction({
            target,
            lang,
            channel,
            template,
            title,
            category,
            body,
            scheduledAt,
            allowDuplicates,
            perParcel,
            expect: preview?.valid ?? 0,
          })
        }
        onDone={(d) => setSent(d as { id: string; number: string; queued: number; scheduled_at: string | null })}
      >
        {() => (
          <div className="space-y-2 text-sm">
            {title && <p className="font-medium">{title}</p>}
            <p className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">{live ?? body}</p>
            {scheduledAt && <p className="text-muted-foreground">{t("goesAt", { at: new Date(scheduledAt).toLocaleString(locale === "so" ? "so-SO" : "en-GB") })}</p>}
          </div>
        )}
      </FormDialog>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">{n}</span>;
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" }) {
  const colour = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</dd>
    </div>
  );
}

/** Find owners by name, ID number, phone or land number, and keep a list of the chosen ones. */
function OwnerPicker({ value, onChange }: { value: OwnerChoice[]; onChange: (next: OwnerChoice[]) => void }) {
  const t = useTranslations("messages.compose");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OwnerChoice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      const r = await searchOwnersAction({ q: term });
      if (!live) return;
      setBusy(false);
      setResults(r.ok ? r.data : []);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const chosen = new Set(value.map((v) => v.id));
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="ps-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchOwners")} aria-label={t("searchOwners")} />
        {busy && <Loader2 className="absolute end-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {q.trim().length >= 2 && !busy && results.length === 0 && <p className="text-xs text-muted-foreground">{t("noOwnersFound")}</p>}
      {results.length > 0 && (
        <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm">
          {results.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{o.full_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <span className="font-mono">{o.phone ?? t("noPhone")}</span>
                  {o.properties && ` · ${o.properties}`}
                  {o.district && ` · ${o.district}`}
                </span>
              </span>
              <Button size="sm" variant="outline" disabled={chosen.has(o.id)} onClick={() => onChange([...value, o])}>
                {chosen.has(o.id) ? t("added") : t("add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="label-caps mb-1.5 text-muted-foreground">{t("chosen", { n: value.length })}</p>
        {value.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noneChosen")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {value.map((o) => (
              <li key={o.id} className="inline-flex items-center gap-1.5 rounded-md border bg-card py-1 ps-2 pe-1 text-xs">
                <span className="font-medium">{o.full_name}</span>
                <span className="font-mono text-muted-foreground">{o.phone ?? "—"}</span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("remove", { name: o.full_name })}
                  onClick={() => onChange(value.filter((x) => x.id !== o.id))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
