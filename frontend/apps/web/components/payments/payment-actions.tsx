"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Printer } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { applyCreditAction, requestReversalAction } from "@/app/[locale]/(staff)/payments/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";

export function PaymentActions({ id, status, unallocated, can }: { id: string; status: string; unallocated: number; can: { reverse: boolean; applyCredit: boolean } }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const [dialog, setDialog] = useState<null | "reverse" | "credit">(null);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/payments/${id}/receipt`} target="_blank">
          <Printer aria-hidden />
          {t("printReceipt")}
        </Link>
      </Button>
      {status === "completed" && unallocated > 0 && can.applyCredit && (
        <Button size="sm" variant="outline" onClick={() => setDialog("credit")}>
          {t("applyCredit")}
        </Button>
      )}
      {status !== "reversed" && can.reverse && (
        <Button size="sm" variant="destructive" onClick={() => setDialog("reverse")}>
          {t("requestReversal")}
        </Button>
      )}
      <FormDialog
        open={dialog === "credit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("applyCredit")}
        description={t("applyCreditBody", { amount: format.number(unallocated, { style: "currency", currency: "USD" }) })}
        confirmLabel={t("applyCredit")}
        successMessage={t("creditApplied")}
        submit={() => applyCreditAction({ id })}
      />
      <FormDialog
        open={dialog === "reverse"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("requestReversal")}
        description={t("requestReversalBody")}
        confirmLabel={t("submitRequest")}
        destructive
        successMessage={t("reversalRequested")}
        submit={() => requestReversalAction({ id, reason })}
      >
        {(fe) => (
          <Field id="reason" label={t("reason")} error={fe("reason")} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}
