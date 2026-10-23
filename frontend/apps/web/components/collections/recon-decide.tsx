"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { decideReconAction } from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Finance Manager: approve or reject a cashier's day. */
export function ReconDecide({ id, number }: { id: string; number: string }) {
  const t = useTranslations("collections.recon");
  const [approve, setApprove] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setApprove(true)}>
        {t("approve")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setApprove(false)}>
        {t("reject")}
      </Button>
      <FormDialog
        open={approve !== null}
        onOpenChange={(o) => !o && setApprove(null)}
        title={approve ? t("approveTitle", { number }) : t("rejectTitle", { number })}
        description={approve ? t("approveBody") : t("rejectBody")}
        confirmLabel={approve ? t("approve") : t("reject")}
        destructive={approve === false}
        submit={() => decideReconAction({ id, approve: approve!, note })}
        successMessage={approve ? t("approved") : t("rejected")}
      >
        {(fe) => (
          <Field id="reconDecision" label={approve ? t("decisionOptional") : t("decisionRequired")} error={fe("note")} required={approve === false}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}
