"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { PenLine, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { disputePaymentAction, requestCorrectionAction } from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { GoApprove } from "@/components/approvals/go-approve";

interface Props {
  paymentId: string;
  status: "pending" | "verified" | "reconciled" | "disputed";
  current: { how: string; reference: string; payerName: string; payerPhone: string };
  can: { verify: boolean; correct: boolean };
  correctionPending: boolean;
}

const HOWS = ["cash", "evc_plus", "edahab", "zaad", "bank_transfer", "cheque"] as const;

/** On a payment: Verify / Dispute (finance officer) and Ask for a correction (cashier who took it or finance officer). */
export function PaymentVerifyActions({ paymentId, status, current, can, correctionPending }: Props) {
  const t = useTranslations("collections");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState<"dispute" | "correct" | null>(null);
  const [note, setNote] = useState("");
  const [c, setC] = useState({ how: current.how, reference: current.reference, payerName: current.payerName, payerPhone: current.payerPhone, reason: "" });
  const card = current.how === "card";

  return (
    <div className="flex flex-wrap gap-2">
      {/* Approving a payment happens on the Applications page. */}
      {can.verify && (status === "pending" || status === "disputed") && <GoApprove tab="accounting" />}
      {can.verify && (status === "pending" || status === "verified") && (
        <Button size="sm" variant="outline" onClick={() => setOpen("dispute")}>
          <Undo2 aria-hidden />
          {t("verify.dispute")}
        </Button>
      )}
      {can.correct && status !== "reconciled" && !correctionPending && (
        <Button size="sm" variant="outline" onClick={() => setOpen("correct")}>
          <PenLine aria-hidden />
          {t("corrections.ask")}
        </Button>
      )}

      <FormDialog
        open={open === "dispute"}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t("verify.disputeTitle", { receipt: "" })}
        description={t("verify.disputeBody")}
        confirmLabel={t("verify.dispute")}
        destructive
        submit={() => disputePaymentAction({ id: paymentId, reason: note })}
        successMessage={t("verify.disputed")}
      >
        {(fe) => (
          <Field id="reason" label={t("verify.reason")} error={fe("reason")} required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={open === "correct"}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t("corrections.askTitle")}
        description={t("corrections.askBody")}
        confirmLabel={t("corrections.send")}
        submit={() =>
          requestCorrectionAction({
            paymentId,
            how: !card && c.how !== current.how ? (c.how as (typeof HOWS)[number]) : "",
            reference: c.reference !== current.reference ? c.reference : undefined,
            payerName: c.payerName !== current.payerName ? c.payerName : undefined,
            payerPhone: c.payerPhone !== current.payerPhone ? c.payerPhone : undefined,
            reason: c.reason,
          })
        }
        successMessage={t("corrections.sent")}
      >
        {(fe) => (
          <div className="grid gap-3">
            {!card && (
              <Field id="how" label={tp("method")} error={fe("how")}>
                <NativeSelect value={c.how} onChange={(e) => setC({ ...c, how: e.target.value })}>
                  {HOWS.map((h) => (
                    <option key={h} value={h}>
                      {tp.has(`wallets.${h}`) ? tp(`wallets.${h}`) : tp(`methods.${h}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id="reference" label={tp("transactionRef")} error={fe("reference")}>
              <Input value={c.reference} onChange={(e) => setC({ ...c, reference: e.target.value })} className="font-mono" maxLength={80} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="payerName" label={tp("payerName")}>
                <Input value={c.payerName} onChange={(e) => setC({ ...c, payerName: e.target.value })} maxLength={120} />
              </Field>
              <Field id="payerPhone" label={tp("payerPhone")}>
                <Input value={c.payerPhone} onChange={(e) => setC({ ...c, payerPhone: e.target.value })} inputMode="tel" maxLength={20} />
              </Field>
            </div>
            <Field id="reason" label={t("corrections.reason")} hint={t("corrections.amountHint")} error={fe("reason")} required>
              <Textarea value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} rows={3} maxLength={500} />
            </Field>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
