"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { CircleHelp, CircleX, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { confirmParcelSiteAction, requestParcelCheckAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Ask for the check (staff), or answer it (the surveyor sent, or a survey supervisor). */
export function SiteCheckButtons({ parcelId, canRequest, canAnswer, size = "default" }: { parcelId: string; canRequest: boolean; canAnswer: boolean; size?: "sm" | "default" }) {
  const t = useTranslations("parcels.siteCheck");
  const [open, setOpen] = useState<"request" | "found" | "not_found" | null>(null);
  const [note, setNote] = useState("");
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      setNote("");
    }
  };
  return (
    <>
      {canRequest && (
        <Button size={size} variant="outline" onClick={() => setOpen("request")}>
          <CircleHelp aria-hidden />
          {t("request")}
        </Button>
      )}
      {canAnswer && (
        <>
          <Button size={size} onClick={() => setOpen("found")}>
            <CheckCircle2 aria-hidden />
            {t("exists")}
          </Button>
          <Button size={size} variant="outline" onClick={() => setOpen("not_found")}>
            <CircleX aria-hidden />
            {t("notFound")}
          </Button>
        </>
      )}
      <FormDialog
        open={open === "request"}
        onOpenChange={close}
        title={t("requestTitle")}
        description={t("requestBody")}
        confirmLabel={t("request")}
        successMessage={t("requested")}
        submit={() => requestParcelCheckAction({ id: parcelId, note })}
      >
        {() => (
          <Field id="checkNote" label={t("noteOptional")}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={open === "found" || open === "not_found"}
        onOpenChange={close}
        title={open === "found" ? t("existsTitle") : t("notFoundTitle")}
        description={open === "found" ? t("existsBody") : t("notFoundBody")}
        confirmLabel={open === "found" ? t("exists") : t("notFound")}
        destructive={open === "not_found"}
        successMessage={t("answered")}
        submit={() => confirmParcelSiteAction({ id: parcelId, exists: open === "found", note })}
      >
        {() => (
          <Field id="answerNote" label={open === "found" ? t("noteOptional") : t("noteRequired")} required={open === "not_found"}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
