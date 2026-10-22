"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Ruler, RefreshCw } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { correctLandAction, rebillAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Staff correct the plot size and type of house after checking it; the invoices then show Re-bill. */
export function CorrectLandButton({
  applicationId,
  widthM,
  lengthM,
  propertyType,
  propertyTypes,
}: {
  applicationId: string;
  widthM: number | null;
  lengthM: number | null;
  propertyType: string | null;
  propertyTypes: { code: string; name_so: string; name_en: string; price: number; active: boolean }[];
}) {
  const t = useTranslations("applications");
  const locale = useLocale();
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const start = () => ({ w: widthM != null ? String(widthM) : "", l: lengthM != null ? String(lengthM) : "", type: propertyType ?? "", note: "" });
  const [v, setV] = useState(start);
  const area = Number(v.w) > 0 && Number(v.l) > 0 ? Number(v.w) * Number(v.l) : null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setV(start());
          setOpen(true);
        }}
      >
        <Ruler aria-hidden />
        {t("correctLand")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("correctLandTitle")}
        description={t("correctLandBody")}
        confirmLabel={t("correctLandSave")}
        successMessage={t("correctLandDone")}
        submit={() => correctLandAction({ applicationId, widthM: Number(v.w), lengthM: Number(v.l), propertyType: v.type, note: v.note })}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="cl-w" label={t("plotWidth")} error={fe("widthM")} required>
                <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.w} onChange={(e) => setV({ ...v, w: e.target.value })} />
              </Field>
              <Field id="cl-l" label={t("plotLength")} error={fe("lengthM")} required>
                <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.l} onChange={(e) => setV({ ...v, l: e.target.value })} />
              </Field>
            </div>
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("declaredArea")}: {area ? `${format.number(area, { maximumFractionDigits: 2 })} m²` : "—"}
            </p>
            <Field id="cl-type" label={t("propertyType")}>
              <NativeSelect value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
                <option value="">{t("choose")}</option>
                {propertyTypes
                  .filter((p) => p.active || p.code === v.type)
                  .map((p) => (
                    <option key={p.code} value={p.code}>
                      {locale === "so" ? p.name_so : p.name_en}
                      {Number(p.price) > 0 ? ` — ${format.number(Number(p.price), { style: "currency", currency: "USD" })} / m²` : ""}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field id="cl-note" label={t("noteOptional")}>
              <Textarea rows={2} value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}

/** Re-bill: update the same invoices to what the size and type cost now. */
export function RebillButton({ applicationId, label }: { applicationId: string; label: string }) {
  const t = useTranslations("applications");
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await rebillAction({ applicationId });
        setBusy(false);
        if (res.ok) toast.success(t("rebillDone"));
        else toast.error(t("rebillFailed"));
      }}
    >
      <RefreshCw aria-hidden />
      {label}
    </Button>
  );
}
