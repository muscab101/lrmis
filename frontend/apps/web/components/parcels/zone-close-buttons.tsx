"use client";

import { Button } from "@dhulka/ui/button";
import { CheckCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { closeZoneAction } from "@/app/[locale]/(staff)/parcels/yet-to-register/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** On a zone's page: Mark done (its surveyor or a manager) and Cancel (a manager). */
export function ZoneCloseButtons({ id, name, canDone, canCancel }: { id: string; name: string; canDone: boolean; canCancel: boolean }) {
  const t = useTranslations("yetToRegister.zones");
  const [status, setStatus] = useState<"done" | "cancelled" | null>(null);
  return (
    <>
      {canDone && (
        <Button variant="outline" onClick={() => setStatus("done")}>
          <CheckCheck aria-hidden />
          {t("done")}
        </Button>
      )}
      {canCancel && (
        <Button variant="ghost" onClick={() => setStatus("cancelled")}>
          <X aria-hidden />
          {t("cancel")}
        </Button>
      )}
      <FormDialog
        open={status !== null}
        onOpenChange={(o) => !o && setStatus(null)}
        title={status === "cancelled" ? t("cancelTitle", { name }) : t("doneTitle", { name })}
        description={status === "cancelled" ? t("cancelBody") : t("doneBody")}
        confirmLabel={status === "cancelled" ? t("cancel") : t("done")}
        destructive={status === "cancelled"}
        successMessage={t("closed")}
        submit={() => closeZoneAction({ id, status: status! })}
      />
    </>
  );
}
