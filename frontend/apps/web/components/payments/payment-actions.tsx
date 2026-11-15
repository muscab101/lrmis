"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Coins, Eye, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { applyCreditAction, requestReversalAction } from "@/app/[locale]/(staff)/payments/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import { SendToPrinter } from "@/components/printing/send-to-printer";

/** A payment's keys. `compact`: icon buttons for a list row (View, Print receipt, Apply credit, Request reversal). */
export function PaymentActions({
  id,
  status,
  unallocated,
  can,
  compact = false,
}: {
  id: string;
  status: string;
  unallocated: number;
  can: { reverse: boolean; applyCredit: boolean };
  compact?: boolean;
}) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const [dialog, setDialog] = useState<null | "reverse" | "credit">(null);
  const [reason, setReason] = useState("");
  const showCredit = status === "completed" && unallocated > 0 && can.applyCredit;
  const showReverse = status !== "reversed" && can.reverse;
  const key = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;
  return (
    <div className={compact ? "flex justify-end gap-0.5" : "flex flex-wrap gap-2"}>
      {compact ? (
        <>
          {key(
            t("viewPayment"),
            <Button asChild variant="ghost" size="icon-sm" className="text-primary">
              <Link href={`/payments/${id}`} aria-label={t("viewPayment")}>
                <Eye aria-hidden />
              </Link>
            </Button>,
          )}
          <SendToPrinter kind="receipt" id={id} label={t("printReceipt")} iconOnly />
          {showCredit &&
            key(
              t("applyCredit"),
              <Button variant="ghost" size="icon-sm" aria-label={t("applyCredit")} onClick={() => setDialog("credit")}>
                <Coins aria-hidden />
              </Button>,
            )}
          {showReverse &&
            key(
              t("requestReversal"),
              <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("requestReversal")} onClick={() => setDialog("reverse")}>
                <Undo2 aria-hidden />
              </Button>,
            )}
        </>
      ) : (
        <>
          <SendToPrinter kind="receipt" id={id} label={t("printReceipt")} />
          {showCredit && (
            <Button size="sm" variant="outline" onClick={() => setDialog("credit")}>
              {t("applyCredit")}
            </Button>
          )}
          {showReverse && (
            <Button size="sm" variant="destructive" onClick={() => setDialog("reverse")}>
              {t("requestReversal")}
            </Button>
          )}
        </>
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
