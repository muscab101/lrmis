"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteOwnerTypeAction, saveOwnerTypeAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { OwnerType } from "@/lib/server/valuation";

/** Owner types: list + add/edit dialog. They are the choices on the owner form. */
export function OwnerTypesEditor({ items, canEdit }: { items: OwnerType[]; canEdit: boolean }) {
  const t = useTranslations("valuation");
  const locale = useLocale();
  const blank = { id: null as string | null, nameSo: "", nameEn: "", active: true };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<OwnerType | null>(null);
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-sm text-muted-foreground">{t("ownerTypesHelp")}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setForm(blank)}>
            <Plus aria-hidden />
            {t("addOwnerType")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead className="text-end">{t("ownerTypeOwners")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canEdit && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="text-sm">{name(i)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{i.owners}</TableCell>
              <TableCell className="text-sm">{i.active ? t("active") : t("inactive")}</TableCell>
              {canEdit && (
                <TableCell>
                  <Button size="icon-sm" variant="ghost" aria-label={t("edit")} onClick={() => setForm({ id: i.id, nameSo: i.name_so, nameEn: i.name_en, active: i.active })}>
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
        title={form?.id ? t("editItem") : t("addOwnerType")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => saveOwnerTypeAction(form!)}
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
          description={t("deleteOwnerTypeBody")}
          confirmLabel={t("deleteFee")}
          destructive
          submit={() => deleteOwnerTypeAction({ id: deleting.id })}
          onDone={(d) => toast.success((d as { result: string }).result === "hidden" ? t("ownerTypeHidden") : t("ownerTypeDeleted"))}
        />
      )}
    </div>
  );
}
