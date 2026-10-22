"use client";

import { Button } from "@dhulka/ui/button";
import { ClipboardPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { startRegistrationAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

/** Field land → a draft application, then straight to it for the bill, survey and registration. */
export function StartRegistrationButton({ parcelId, label }: { parcelId: string; label: string }) {
  const t = useTranslations("parcels.fieldLand");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="mt-1" onClick={() => setOpen(true)}>
        <ClipboardPlus aria-hidden />
        {t("start")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("startTitle")}
        description={t("startBody", { land: label })}
        confirmLabel={t("start")}
        submit={() => startRegistrationAction({ parcelId })}
        onDone={(d) => {
          const app = d as { id: string; number: string };
          router.push(`/applications/${app.id}`);
        }}
        successMessage={t("started")}
      />
    </>
  );
}
