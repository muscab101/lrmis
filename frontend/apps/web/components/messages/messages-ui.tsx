"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { cancelMessageAction, retryMessageAction, updateTemplateAction } from "@/app/[locale]/(staff)/messages/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { MessageRow, TemplateRow } from "@/lib/server/messages";

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
