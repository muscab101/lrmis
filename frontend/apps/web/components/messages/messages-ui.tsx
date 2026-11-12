"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Inbox, Megaphone } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelMessageAction,
  createCampaignAction,
  decideCampaignAction,
  previewCampaignAction,
  retryMessageAction,
  updateTemplateAction,
} from "@/app/[locale]/(staff)/messages/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { DecideButtons } from "@/components/legal/decide";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { CampaignRow, MessageRow, TemplateRow } from "@/lib/server/messages";

const mask = (p: string) => p.replace(/^(\+\d{3})\d+(\d{3})$/, "$1 ••• $2");

export function Outbox({ rows, can }: { rows: MessageRow[]; can: { retry: boolean; cancel: boolean } }) {
  const t = useTranslations("messages");
  const format = useFormatter();
  const router = useRouter();
  const em = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noMessages")} description={t("noMessagesBody")} />;
  const run = async (id: string, fn: typeof retryMessageAction) => {
    setBusy(id);
    const r = await fn({ id });
    setBusy(null);
    if (r.ok) {
      toast.success(t("updated"));
      router.refresh();
    } else toast.error(em(r.error));
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("to")}</TableHead>
          <TableHead>{t("message")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          <TableHead>{t("when")}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.id}>
            <TableCell className="text-sm whitespace-nowrap">
              <Mono>{mask(m.to_address)}</Mono>
              {m.party && <span className="block text-xs text-muted-foreground">{m.party.full_name}</span>}
            </TableCell>
            <TableCell className="max-w-md text-sm">
              <span className="line-clamp-2">{m.body}</span>
              <span className="text-xs text-muted-foreground">{m.template_code ? t(`templates.${m.template_code}`) : ""}</span>
            </TableCell>
            <TableCell className="text-sm">
              {t(`status.${m.status}`)}
              {m.attempts > 1 && <span className="block text-xs text-muted-foreground">{t("attempts", { n: m.attempts })}</span>}
              {m.last_error && <span className="block max-w-48 truncate text-xs text-status-rejected" title={m.last_error}>{m.last_error}</span>}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap">{format.dateTime(new Date(m.sent_at ?? m.created_at), { dateStyle: "short", timeStyle: "short" })}</TableCell>
            <TableCell className="text-end">
              {can.retry && (m.status === "failed" || m.status === "cancelled") && (
                <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => run(m.id, retryMessageAction)}>
                  {t("retry")}
                </Button>
              )}
              {can.cancel && m.status === "queued" && (
                <Button size="sm" variant="ghost" disabled={busy === m.id} onClick={() => run(m.id, cancelMessageAction)}>
                  {t("cancel")}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type Template = "overdue_reminder" | "tax_due" | "general_notice";

export function NewCampaign({ districts, allDistricts }: { districts: { id: string; name_so: string; name_en: string }[]; allDistricts: boolean }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const vm = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<Template>("overdue_reminder");
  const [minDays, setMinDays] = useState("30");
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [text, setText] = useState("");
  const [district, setDistrict] = useState(allDistricts ? "" : (districts[0]?.id ?? ""));
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ recipients: number; sample: string | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<AppError | null>(null);

  const input = () => ({
    template,
    audience:
      template === "overdue_reminder" ? { kind: "overdue" as const, min_days: Number(minDays) || 0 } : template === "tax_due" ? { kind: "tax_due" as const, period } : { kind: "owners" as const, text },
    district: district || null,
    note,
  });

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    const r = await previewCampaignAction(input());
    setPreviewing(false);
    if (r.ok) setPreview({ recipients: r.data.recipients, sample: locale === "en" ? r.data.sample_en : r.data.sample_so });
    else setPreviewError(r.error);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Megaphone aria-hidden />
        {t("newCampaign")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPreview(null);
        }}
        title={t("newCampaign")}
        description={t("newCampaignBody")}
        confirmLabel={t("sendForApproval")}
        successMessage={t("campaignCreated")}
        submit={() => createCampaignAction(input())}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="template" label={t("template")}>
                <NativeSelect
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value as Template);
                    setPreview(null);
                  }}
                >
                  {(["overdue_reminder", "tax_due", "general_notice"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`templates.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="district" label={t("district")} error={fe("district")}>
                <NativeSelect value={district} onChange={(e) => (setDistrict(e.target.value), setPreview(null))}>
                  {allDistricts && <option value="">{t("allDistricts")}</option>}
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {locale === "so" ? d.name_so : d.name_en}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {template === "overdue_reminder" && (
                <Field id="minDays" label={t("minDays")} hint={t("minDaysHint")}>
                  <Input type="number" min={0} value={minDays} onChange={(e) => (setMinDays(e.target.value), setPreview(null))} />
                </Field>
              )}
              {template === "tax_due" && (
                <Field id="period" label={t("period")} error={fe("audience.period")}>
                  <Input inputMode="numeric" maxLength={4} value={period} onChange={(e) => (setPeriod(e.target.value), setPreview(null))} />
                </Field>
              )}
            </div>
            {template === "general_notice" && (
              <Field id="text" label={t("noticeText")} hint={t("noticeTextHint")} error={fe("text")} required>
                <Textarea rows={3} maxLength={400} value={text} onChange={(e) => (setText(e.target.value), setPreview(null))} />
              </Field>
            )}
            <Field id="note" label={t("noteForApprover")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {preview ? (
                <>
                  <p className="font-medium">{t("recipients", { n: preview.recipients })}</p>
                  {preview.sample && <p className="mt-1 text-muted-foreground">“{preview.sample}”</p>}
                </>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={previewing}>
                  {t("preview")}
                </Button>
              )}
              {(previewError || fe("audience")) && <p className="mt-1 text-status-rejected">{previewError ? vm(previewError) : fe("audience")}</p>}
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}

export function CampaignTable({ rows, me, canDecide }: { rows: CampaignRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const format = useFormatter();
  if (rows.length === 0) return <EmptyState icon={<Megaphone />} title={t("noCampaigns")} description={t("noCampaignsBody")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("template")}</TableHead>
          <TableHead>{t("audience")}</TableHead>
          <TableHead className="text-end">{t("recipientsLabel")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          {canDecide && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Mono>{c.number}</Mono>
              <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(c.created_at), { dateStyle: "medium" })}</span>
            </TableCell>
            <TableCell className="text-sm">{t(`templates.${c.template_code}`)}</TableCell>
            <TableCell className="text-sm">
              {c.audience.kind === "overdue" ? t("audOverdue", { n: c.audience.min_days ?? 0 }) : c.audience.kind === "tax_due" ? t("audTaxDue", { period: c.audience.period ?? "" }) : t("audOwners")}
              <span className="block text-xs text-muted-foreground">{c.district ? (locale === "so" ? c.district.name_so : c.district.name_en) : t("allDistricts")}</span>
              {c.note && <span className="block max-w-xs text-xs text-muted-foreground">{c.note}</span>}
            </TableCell>
            <TableCell className="text-end text-sm tabular-nums">{c.recipients}</TableCell>
            <TableCell className="text-sm">
              {t(`campaignStatus.${c.status}`)}
              {c.decision_note && <span className="block max-w-xs text-xs text-muted-foreground">{c.decision_note}</span>}
            </TableCell>
            {canDecide && (
              <TableCell className="text-end whitespace-nowrap">
                {c.status === "draft" && c.created_by !== me && <DecideButtons decide={(v) => decideCampaignAction({ id: c.id, approve: v.approve, note: v.note })} />}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TemplateList({ rows, canEdit }: { rows: TemplateRow[]; canEdit: boolean }) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {rows.map((r) => (
        <TemplateCard key={r.code} row={r} canEdit={canEdit} />
      ))}
    </div>
  );
}

function TemplateCard({ row, canEdit }: { row: TemplateRow; canEdit: boolean }) {
  const t = useTranslations("messages");
  const [open, setOpen] = useState(false);
  const [so, setSo] = useState(row.body_so);
  const [en, setEn] = useState(row.body_en);
  const [active, setActive] = useState(row.active);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">{t(`templates.${row.code}`)}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {row.is_system ? t("system") : t("campaign")} · {row.active ? t("on") : t("off")}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("edit")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <span className="label-caps me-2 text-muted-foreground">SO</span>
          {row.body_so}
        </p>
        <p>
          <span className="label-caps me-2 text-muted-foreground">EN</span>
          {row.body_en}
        </p>
      </CardContent>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t(`templates.${row.code}`)}
        description={t("placeholdersHint")}
        confirmLabel={t("save")}
        successMessage={t("updated")}
        submit={() => updateTemplateAction({ code: row.code, bodySo: so, bodyEn: en, active })}
      >
        {(fe) => (
          <>
            <Field id="so" label={t("bodySo")} hint={t("chars", { n: so.length })} error={fe("bodySo") ?? fe("body_so")} required>
              <Textarea rows={3} maxLength={640} value={so} onChange={(e) => setSo(e.target.value)} />
            </Field>
            <Field id="en" label={t("bodyEn")} hint={t("chars", { n: en.length })} error={fe("bodyEn")} required>
              <Textarea rows={3} maxLength={640} value={en} onChange={(e) => setEn(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
              {t("activeLabel")}
            </label>
          </>
        )}
      </FormDialog>
    </Card>
  );
}
