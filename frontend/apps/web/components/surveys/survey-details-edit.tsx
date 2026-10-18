"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateSurveyDetailsAction } from "@/app/[locale]/(staff)/surveys/actions";
import { FormDialog } from "@/components/forms/form-dialog";

interface Details {
  plot_no: string | null;
  house_no: string | null;
  govt_receipt_no: string | null;
  plot_width_m: number | null;
  plot_length_m: number | null;
  address_note: string;
}

/** The land details the surveyor can correct on site. */
export function SurveyDetailsEdit({ surveyId, details }: { surveyId: string; details: Details }) {
  const t = useTranslations("surveys");
  const ta = useTranslations("applications");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const initial = () => ({
    plotNo: details.plot_no ?? "",
    houseNo: details.house_no ?? "",
    govtReceiptNo: details.govt_receipt_no ?? "",
    plotWidthM: details.plot_width_m != null ? String(details.plot_width_m) : "",
    plotLengthM: details.plot_length_m != null ? String(details.plot_length_m) : "",
    addressNote: details.address_note ?? "",
  });
  const [v, setV] = useState(initial);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setV(initial());
          setOpen(true);
        }}
      >
        <Pencil aria-hidden />
        {tc("edit")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("editDetailsTitle")}
        description={t("editDetailsBody")}
        confirmLabel={tc("saveChanges")}
        successMessage={tc("saved")}
        submit={() => updateSurveyDetailsAction({ surveyId, ...v, plotWidthM: num(v.plotWidthM), plotLengthM: num(v.plotLengthM) })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sd-plot" label={ta("plotNo")} error={fe("plotNo")}>
              <Input value={v.plotNo} maxLength={40} onChange={(e) => setV({ ...v, plotNo: e.target.value })} />
            </Field>
            <Field id="sd-house" label={ta("houseNo")} error={fe("houseNo")}>
              <Input value={v.houseNo} maxLength={40} onChange={(e) => setV({ ...v, houseNo: e.target.value })} />
            </Field>
            <Field id="sd-receipt" label={ta("govtReceiptNo")} error={fe("govtReceiptNo")} className="sm:col-span-2">
              <Input value={v.govtReceiptNo} maxLength={60} onChange={(e) => setV({ ...v, govtReceiptNo: e.target.value })} />
            </Field>
            <Field id="sd-width" label={t("widthM")} error={fe("plotWidthM")}>
              <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.plotWidthM} onChange={(e) => setV({ ...v, plotWidthM: e.target.value })} />
            </Field>
            <Field id="sd-length" label={t("lengthM")} error={fe("plotLengthM")}>
              <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.plotLengthM} onChange={(e) => setV({ ...v, plotLengthM: e.target.value })} />
            </Field>
            <Field id="sd-note" label={ta("addressNote")} error={fe("addressNote")} className="sm:col-span-2">
              <Textarea rows={2} value={v.addressNote} maxLength={500} onChange={(e) => setV({ ...v, addressNote: e.target.value })} />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}
