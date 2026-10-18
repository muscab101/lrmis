"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createRunAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

interface Props {
  districts: { id: string; code: string; name_so: string; name_en: string }[];
  feeTypes: { id: string; code: string; name_so: string; name_en: string; interval: string }[];
  /** Open straight away (menu: Billing → Create batches). */
  defaultOpen?: boolean;
}

/** Step 1 of the billing-run wizard: period, fee and districts. The preview follows on the run page. */
export function NewRunButton({ districts, feeTypes, defaultOpen = false }: Props) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const router = useRouter();
  const recurring = feeTypes.filter((f) => f.interval !== "one_off");
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(defaultOpen);
  const [v, setV] = useState({ year: String(year), feeTypeId: recurring[0]?.id ?? "", districtIds: [] as string[], dueDate: `${year}-12-31`, note: "" });
  const toggle = (id: string, on: boolean) => setV((s) => ({ ...s, districtIds: on ? [...s.districtIds, id] : s.districtIds.filter((d) => d !== id) }));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("newRun")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("newRun")}
        description={t("newRunBody")}
        confirmLabel={t("preview")}
        submit={() => createRunAction(v)}
        onDone={(d) => router.push(`/billing/runs/${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="year" label={t("year")} error={fe("year")} required>
                <Input type="number" min={2000} max={2100} value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} />
              </Field>
              <Field id="due" label={t("dueDate")} error={fe("dueDate")} required>
                <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
              </Field>
            </div>
            <Field id="fee" label={t("feeType")} hint={t("feeTypeHint")} error={fe("feeTypeId")} required>
              <NativeSelect value={v.feeTypeId} onChange={(e) => setV({ ...v, feeTypeId: e.target.value })}>
                {recurring.map((f) => (
                  <option key={f.id} value={f.id}>
                    {locale === "so" ? f.name_so : f.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="districts" label={t("districts")} error={fe("districtIds")} required>
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3">
                {districts.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.districtIds.includes(d.id)} onCheckedChange={(c) => toggle(d.id, c === true)} />
                    {locale === "so" ? d.name_so : d.name_en}
                  </label>
                ))}
              </div>
            </Field>
            <Field id="note" label={t("noteOptional")}>
              <Input value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
