"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteFeeTypeAction, deleteGradeAction, saveFeeTypeAction, saveGradeAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { FeeType, Grade } from "@/lib/server/valuation";

const INTERVALS = ["annual", "biannual", "quarterly", "monthly", "one_off"] as const;
/** Fee types the system uses by code: Delete switches them off instead of removing them. */
const BUILT_IN_FEES = new Set(["property_tax", "service_charge", "application_fee", "certificate_fee", "transfer_stamp_duty", "building_permit", "registration_fee", "property_bill"]);
type Item = Grade & { interval?: FeeType["interval"] };

/** Property grades or fee types: list + add/edit dialog. */
export function CatalogEditor({ kind, items, canEdit }: { kind: "grades" | "fees"; items: Item[]; canEdit: boolean }) {
  const t = useTranslations("valuation");
  const format = useFormatter();
  const locale = useLocale();
  const blank = { id: null as string | null, code: "", nameSo: "", nameEn: "", amount: "0", active: true, sort: "100", interval: "annual" as FeeType["interval"] };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const set = (k: keyof typeof blank, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-sm text-muted-foreground">{t(kind === "grades" ? "gradesHelp" : "feesHelp")}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setForm(blank)}>
            <Plus aria-hidden />
            {t(kind === "grades" ? "addGrade" : "addFee")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("code")}</TableHead>
            <TableHead>{t("name")}</TableHead>
            {kind === "fees" && <TableHead>{t("interval")}</TableHead>}
            <TableHead className="text-end">{t(kind === "grades" ? "amountPerUnit" : "defaultAmount")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canEdit && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                <Mono>{i.code}</Mono>
              </TableCell>
              <TableCell className="text-sm">{locale === "so" ? i.name_so : i.name_en}</TableCell>
              {kind === "fees" && <TableCell className="text-sm">{t(`intervals.${i.interval}`)}</TableCell>}
              <TableCell className="text-end text-sm tabular-nums">{format.number(Number(i.amount), { style: "currency", currency: "USD" })}</TableCell>
              <TableCell className="text-sm">{i.active ? t("active") : t("inactive")}</TableCell>
              {canEdit && (
                <TableCell>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("edit")}
                    onClick={() =>
                      setForm({ id: i.id, code: i.code, nameSo: i.name_so, nameEn: i.name_en, amount: String(i.amount), active: i.active, sort: String(i.sort), interval: i.interval ?? "annual" })
                    }
                  >
                    <Pencil aria-hidden />
                  </Button>
                  {/* The property bill is priced by the grades, so there is nothing to delete or switch off. */}
                  {!(kind === "fees" && i.code === "property_bill") && (
                    <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={t("delete")} title={t("delete")} onClick={() => setDeleting(i)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <FormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? t("editItem") : t(kind === "grades" ? "addGrade" : "addFee")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => {
          const f = form!;
          const base = { id: f.id, code: f.code, nameSo: f.nameSo, nameEn: f.nameEn, amount: f.amount, active: f.active, sort: f.sort };
          return kind === "grades" ? saveGradeAction(base) : saveFeeTypeAction({ ...base, interval: f.interval });
        }}
      >
        {(fe) =>
          form && (
            <>
              <Field id="code" label={t("code")} hint={t("codeHint")} error={fe("code")} required>
                <Input value={form.code} disabled={!!form.id} onChange={(e) => set("code", e.target.value)} />
              </Field>
              {/* One name, saved for both languages. */}
              <Field id="name" label={t("name")} error={fe("nameEn") ?? fe("nameSo")} required>
                <Input
                  value={form.nameEn}
                  onChange={(e) => {
                    set("nameEn", e.target.value);
                    set("nameSo", e.target.value);
                  }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="amount" label={t(kind === "grades" ? "amountPerUnit" : "defaultAmount")} error={fe("amount")} required>
                  <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                </Field>
                {kind === "fees" ? (
                  <Field id="interval" label={t("interval")}>
                    <NativeSelect value={form.interval} onChange={(e) => set("interval", e.target.value)}>
                      {INTERVALS.map((iv) => (
                        <option key={iv} value={iv}>
                          {t(`intervals.${iv}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : (
                  <Field id="sort" label={t("sort")}>
                    <Input type="number" min={0} value={form.sort} onChange={(e) => set("sort", e.target.value)} />
                  </Field>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
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
          title={t("deleteFeeTitle", { name: locale === "so" ? deleting.name_so : deleting.name_en })}
          description={t(kind === "grades" ? "deleteGradeBody" : BUILT_IN_FEES.has(deleting.code) ? "deleteFeeBuiltInBody" : "deleteFeeBody")}
          confirmLabel={t("deleteFee")}
          destructive
          submit={() => (kind === "grades" ? deleteGradeAction({ id: deleting.id }) : deleteFeeTypeAction({ id: deleting.id }))}
          onDone={(d) =>
            toast.success((d as { result: string }).result === "hidden" ? t(kind === "grades" ? "gradeHidden" : "feeHidden") : t(kind === "grades" ? "gradeDeleted" : "feeDeleted"))
          }
        />
      )}
    </div>
  );
}
