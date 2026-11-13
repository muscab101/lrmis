"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteTransferTypeAction, saveTransferTypeAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { TransferType } from "@/lib/server/valuation";

const RULES = ["sale", "gift", "inheritance"] as const;

/** Transfer types: the choices on the transfer form, each with its rules and stamp duty. */
export function TransferTypesEditor({ items, canEdit }: { items: TransferType[]; canEdit: boolean }) {
  const t = useTranslations("valuation");
  const locale = useLocale();
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const blank = { id: null as string | null, nameSo: "", nameEn: "", worksAs: "sale" as TransferType["works_as"], duty: "0", active: true };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<TransferType | null>(null);
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-muted-foreground text-sm">{t("transferTypesHelp")}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setForm(blank)}>
            <Plus aria-hidden />
            {t("addTransferType")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("transferRules")}</TableHead>
            <TableHead className="text-end">{t("stampDuty")}</TableHead>
            <TableHead className="text-end">{t("transferTypeUsed")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canEdit && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="text-sm font-medium">{name(i)}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{t(`transferRule.${i.works_as}`)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(i.duty)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{i.used}</TableCell>
              <TableCell className="text-sm">{i.active ? t("active") : t("inactive")}</TableCell>
              {canEdit && (
                <TableCell>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("edit")}
                    onClick={() => setForm({ id: i.id, nameSo: i.name_so, nameEn: i.name_en, worksAs: i.works_as, duty: String(i.duty), active: i.active })}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={t("delete")} title={t("delete")} onClick={() => setDeleting(i)}>
                    <Trash2 aria-hidden />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <FormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? t("editItem") : t("addTransferType")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => saveTransferTypeAction({ ...form!, duty: Number(form!.duty || 0) })}
      >
        {(fe) =>
          form && (
            <>
              {/* One name: a new type is saved with it in both languages; editing changes the language on screen. */}
              <Field id="name" label={t("name")} error={fe("nameEn") ?? fe("nameSo")} required>
                <Input
                  value={locale === "so" ? form.nameSo : form.nameEn}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => (f ? (f.id ? { ...f, [locale === "so" ? "nameSo" : "nameEn"]: v } : { ...f, nameSo: v, nameEn: v }) : f));
                  }}
                />
              </Field>
              <Field id="rules" label={t("transferRules")} hint={t("transferRulesHint")}>
                <NativeSelect value={form.worksAs} onChange={(e) => setForm((f) => (f ? { ...f, worksAs: e.target.value as TransferType["works_as"] } : f))}>
                  {RULES.map((r) => (
                    <option key={r} value={r}>
                      {t(`transferRule.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="duty" label={t("stampDutyUsd")} hint={t("stampDutyHint")} error={fe("duty")}>
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={form.duty} onChange={(e) => setForm((f) => (f ? { ...f, duty: e.target.value } : f))} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => (f ? { ...f, active: v } : f))} />
                {t("active")}
              </label>
            </>
          )
        }
      </FormDialog>

      {deleting && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={t("deleteFeeTitle", { name: name(deleting) })}
          description={t("deleteTransferTypeBody")}
          confirmLabel={t("deleteFee")}
          destructive
          submit={() => deleteTransferTypeAction({ id: deleting.id })}
          onDone={(d) => toast.success((d as { result: string }).result === "hidden" ? t("transferTypeHidden") : t("transferTypeDeleted"))}
        />
      )}
    </div>
  );
}
