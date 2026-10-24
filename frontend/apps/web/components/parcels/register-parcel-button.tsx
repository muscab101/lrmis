"use client";

import { Button } from "@dhulka/ui/button";
import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { registerParcelAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Partial land → registered: PUN and account number, the tax bill and service charge, owners registered. */
export function RegisterParcelButton({ parcelId, label, size = "sm" }: { parcelId: string; label: string; size?: "sm" | "default" }) {
  const t = useTranslations("parcels.fieldLand");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} className={size === "sm" ? "mt-1" : undefined} onClick={() => setOpen(true)}>
        <BadgeCheck aria-hidden />
        {t("register")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("registerTitle")}
        description={t("registerBody", { land: label })}
        confirmLabel={t("register")}
        submit={() => registerParcelAction({ parcelId })}
        successMessage={t("registered")}
      />
    </>
  );
}
