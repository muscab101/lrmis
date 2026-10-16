"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import type { ActionResult } from "@dhulka/core/errors";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";

/** Approve / reject buttons with a note (required to reject); optional conditions field for permits. */
export function DecideButtons({
  decide,
  withConditions = false,
}: {
  decide: (v: { approve: boolean; note: string; conditions: string }) => Promise<ActionResult<unknown>>;
  withConditions?: boolean;
}) {
  const t = useTranslations("legal");
  const [approve, setApprove] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState("");
  return (
    <span className="inline-flex gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setApprove(false)}>
        {t("reject")}
      </Button>
      <Button size="sm" onClick={() => setApprove(true)}>
        {t("approve")}
      </Button>
      <FormDialog
        open={approve !== null}
        onOpenChange={(o) => {
          if (!o) {
            setApprove(null);
            setNote("");
            setConditions("");
          }
        }}
        title={approve ? t("approveTitle") : t("rejectTitle")}
        description={approve ? t("approveBody") : undefined}
        confirmLabel={approve ? t("approve") : t("reject")}
        destructive={approve === false}
        successMessage={t("decided")}
        submit={() => decide({ approve: !!approve, note, conditions })}
      >
        {(fe) => (
          <>
            {approve && withConditions && (
              <Field id="conditions" label={t("conditions")}>
                <Textarea rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} />
              </Field>
            )}
            <Field id="note" label={approve ? t("noteOptional") : t("reason")} error={fe("note")} required={!approve}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </span>
  );
}
