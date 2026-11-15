"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { buildingTaxSetupAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** A flats building's footprint; saving works out every flat's share and the open-ground bill again. */
export function BuildingTaxEdit({
  id,
  plotM2,
  current,
}: {
  id: string;
  plotM2: number | null;
  current: { footprint: number | null; managerName: string | null; managerPhone: string | null };
}) {
  const t = useTranslations("parcels.landUnits");
  const [open, setOpen] = useState(false);
  const [footprint, setFootprint] = useState(current.footprint != null ? String(current.footprint) : "");
  // The manager is chosen as a person (Manager, below); saving the footprint keeps them as they are.
  const name = current.managerName ?? "";
  const phone = current.managerPhone ?? "";
  const foot = Number(footprint);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PenLine aria-hidden />
        {t("editBuilding")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("editBuilding")}
        description={t("editBuildingBody")}
        confirmLabel={t("saveBuilding")}
        submit={() =>
          buildingTaxSetupAction({ id, footprintM2: footprint.trim() === "" ? null : foot, managerName: name, managerPhone: phone })
        }
        successMessage={t("buildingSaved")}
      >
        {(fe) => (
          <>
            <Field
              id="footprint"
              label={t("footprint")}
              hint={foot > 0 && plotM2 ? t("openGround", { m2: `${Math.max(Math.round((plotM2 - foot) * 100) / 100, 0)} m²` }) : t("footprintHint")}
              error={fe("footprintM2")}
            >
              <Input type="number" inputMode="decimal" min={0} value={footprint} onChange={(e) => setFootprint(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
