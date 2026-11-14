"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { assessNeighbourhoodAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { ComboOption } from "@dhulka/ui/combobox";
import { NeighbourhoodPicker } from "./neighbourhood-picker";

/** Assess a whole neighbourhood at once. (Exemptions and appeals are no longer used.) */
export function AssessNeighbourhoodButton() {
  const t = useTranslations("valuation");
  const [open, setOpen] = useState(false);
  const [nbhd, setNbhd] = useState<ComboOption | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("assessNeighbourhood")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("assessNeighbourhood")}
        description={t("assessNeighbourhoodBody")}
        confirmLabel={t("assess")}
        submit={() => assessNeighbourhoodAction({ neighbourhoodId: nbhd?.value ?? "", year })}
        onDone={(d) => {
          const r = d as { assessed: number; skipped: number };
          toast.success(t("assessedCount", { assessed: r.assessed, skipped: r.skipped }));
        }}
      >
        {(fe) => (
          <>
            <Field id="nbhd" label={t("neighbourhood")} error={fe("neighbourhoodId")} required>
              <div>
                <NeighbourhoodPicker value={nbhd} onChange={setNbhd} />
              </div>
            </Field>
            <Field id="year" label={t("year")} error={fe("year")} required>
              <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
