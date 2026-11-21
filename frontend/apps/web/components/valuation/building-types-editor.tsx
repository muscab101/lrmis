"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { deleteBuildingTypeAction, saveBuildingTypeAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { BuildingType, Grade } from "@/lib/server/valuation";

const LAYOUTS = ["house", "flats", "compound"] as const;

/** Building types: the "Building type" choices on the land form, each with its kind of land and the price that bills it. */
export function BuildingTypesEditor({ items, grades, canEdit }: { items: BuildingType[]; grades: Grade[]; canEdit: boolean }) {
  const t = useTranslations("valuation");
  const locale = useLocale();
  const format = useFormatter();
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  const grade = (code: string) => grades.find((g) => g.code === code);
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const priced = grades.filter((g) => g.active && g.code !== "upper" && g.code !== "open_ground");
  const blank = { id: null as string | null, nameSo: "", nameEn: "", layout: "house" as BuildingType["layout"], gradeCode: priced[0]?.code ?? "", active: true };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<BuildingType | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-muted-foreground text-sm">{t("buildingTypesHelp")}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setForm(blank)}>
            <Plus aria-hidden />
            {t("addBuildingType")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("buildingLayout")}</TableHead>
            <TableHead>{t("buildingGrade")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canEdit && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 5 : 4} className="text-muted-foreground text-sm">
                {t("buildingTypesNone")}
              </TableCell>
            </TableRow>
          )}
          {items.map((i) => {
            const g = grade(i.grade_code);
            return (
              <TableRow key={i.id}>
                <TableCell className="text-sm font-medium">{name(i)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{t(`buildingLayouts.${i.layout}`)}</TableCell>
                <TableCell className="text-sm">
                  {g ? `${name(g)} · ${usd(Number(g.amount))}/m²` : i.grade_code}
                  {i.layout === "flats" && <span className="text-muted-foreground block text-xs">{t("buildingFlatsNote")}</span>}
                </TableCell>
                <TableCell className="text-sm">{i.active ? t("active") : t("inactive")}</TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("edit")}
                      onClick={() => setForm({ id: i.id, nameSo: i.name_so, nameEn: i.name_en, layout: i.layout, gradeCode: i.grade_code, active: i.active })}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={t("delete")} title={t("delete")} onClick={() => setDeleting(i)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <FormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? t("editItem") : t("addBuildingType")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => saveBuildingTypeAction(form!)}
      >
        {(fe) =>
          form && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="nameSo" label={t("nameSo")} error={fe("nameSo")} required>
                  <Input value={form.nameSo} onChange={(e) => setForm((f) => (f ? { ...f, nameSo: e.target.value } : f))} />
                </Field>
                <Field id="nameEn" label={t("nameEn")} error={fe("nameEn")} required>
                  <Input value={form.nameEn} onChange={(e) => setForm((f) => (f ? { ...f, nameEn: e.target.value } : f))} />
                </Field>
              </div>
              <Field id="layout" label={t("buildingLayout")} hint={t(`buildingLayoutHint.${form.layout}`)} error={fe("layout")} required>
                <NativeSelect value={form.layout} onChange={(e) => setForm((f) => (f ? { ...f, layout: e.target.value as BuildingType["layout"] } : f))}>
                  {LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {t(`buildingLayouts.${l}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="gradeCode" label={t("buildingGrade")} hint={t("buildingGradeHint")} error={fe("gradeCode")} required>
                <NativeSelect value={form.gradeCode} onChange={(e) => setForm((f) => (f ? { ...f, gradeCode: e.target.value } : f))}>
                  {priced.map((g) => (
                    <option key={g.code} value={g.code}>
                      {name(g)} · {usd(Number(g.amount))}/m²
                    </option>
                  ))}
                </NativeSelect>
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
          description={t("deleteBuildingTypeBody")}
          confirmLabel={t("deleteFee")}
          destructive
          successMessage={t("buildingTypeDeleted")}
          submit={() => deleteBuildingTypeAction({ id: deleting.id })}
        />
      )}
    </div>
  );
}
