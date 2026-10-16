"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { approveRunAction, cancelRunAction, generateRunAction, refreshRunAction, submitRunAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { RunStatus } from "@/lib/server/billing";

type Step = "refresh" | "submit" | "approve" | "generate" | "cancel";

export function RunActions({ id, status, can, isCreator }: { id: string; status: RunStatus; can: { create: boolean; approve: boolean; cancel: boolean }; isCreator: boolean }) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const [step, setStep] = useState<Step | null>(null);
  const [reason, setReason] = useState("");
  const steps: Step[] = [];
  if (["draft", "submitted", "approved"].includes(status)) steps.push("refresh");
  if (status === "draft" && can.create) steps.push("submit");
  if (status === "submitted" && can.approve && !isCreator) steps.push("approve");
  if ((status === "approved" || status === "generating") && can.approve) steps.push("generate");
  if (["draft", "submitted", "approved"].includes(status) && (isCreator ? can.create : can.cancel)) steps.push("cancel");
  if (steps.length === 0) return null;
  const run = { refresh: refreshRunAction, submit: submitRunAction, approve: approveRunAction, generate: generateRunAction };

  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((s) => (
        <Button key={s} size="sm" variant={s === "cancel" ? "destructive" : s === "refresh" ? "outline" : "default"} onClick={() => setStep(s)}>
          {t(`steps.${s}`)}
        </Button>
      ))}
      {status === "submitted" && isCreator && can.approve && <span className="self-center text-xs text-muted-foreground">{t("needsSomeoneElse")}</span>}
      <FormDialog
        open={step !== null}
        onOpenChange={(o) => {
          if (!o) {
            setStep(null);
            setReason("");
          }
        }}
        title={step ? t(`steps.${step}Title`) : ""}
        description={step ? t(`steps.${step}Body`) : ""}
        confirmLabel={step ? t(`steps.${step}`) : ""}
        destructive={step === "cancel"}
        submit={() => (step === "cancel" ? cancelRunAction({ id, reason }) : run[step as Exclude<Step, "cancel">]({ id }))}
        onDone={(d) => {
          if (step === "generate") {
            const r = d as { created: number; total: number };
            toast.success(t("generated", { count: r.created, total: format.number(Number(r.total), { style: "currency", currency: "USD" }) }));
          } else toast.success(t(`steps.${step}Done`));
        }}
      >
        {step === "cancel"
          ? (fe) => (
              <Field id="reason" label={t("reason")} error={fe("reason")} required>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )
          : undefined}
      </FormDialog>
    </div>
  );
}
