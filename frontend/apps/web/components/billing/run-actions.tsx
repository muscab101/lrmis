"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Ban, CheckCircle2, Eye, FileOutput, RefreshCw, Send, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { approveRunAction, cancelRunAction, generateRunAction, issueNowRunAction, refreshRunAction, submitRunAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { GoApprove } from "@/components/approvals/go-approve";
import { Link } from "@/i18n/navigation";
import type { RunStatus } from "@/lib/server/billing";

type Step = "refresh" | "issueNow" | "submit" | "approve" | "generate" | "cancel";

const ICONS = { refresh: RefreshCw, issueNow: Zap, submit: Send, approve: CheckCircle2, generate: FileOutput, cancel: Ban } as const;

/** A billing run's next steps. `compact`: icon buttons for a list row, with View first. */
export function RunActions({
  id,
  status,
  can,
  isCreator,
  compact = false,
  bills,
}: {
  id: string;
  status: RunStatus;
  can: { create: boolean; approve: boolean; cancel: boolean };
  isCreator: boolean;
  compact?: boolean;
  /** How many bills the run would make: a run with none has nothing to issue. */
  bills?: number;
}) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const [step, setStep] = useState<Step | null>(null);
  const [reason, setReason] = useState("");
  const steps: Step[] = [];
  const empty = bills === 0;
  // A list row keeps it short: View, Issue now (when there is something to bill) and Cancel. Recalculate and Send for
  // approval are on the run's own page.
  if (!compact && ["draft", "submitted", "approved"].includes(status)) steps.push("refresh");
  // Bills out straight away, without waiting for approval.
  if (["draft", "submitted", "approved"].includes(status) && can.create && !empty) steps.push("issueNow");
  if (!compact && status === "draft" && can.create && !empty) steps.push("submit");
  // Approving a run happens on the Applications page.
  if ((status === "approved" || status === "generating") && can.approve) steps.push("generate");
  if (["draft", "submitted", "approved"].includes(status) && (isCreator ? can.create : can.cancel)) steps.push("cancel");
  if (steps.length === 0 && !compact) return null;
  const run = { refresh: refreshRunAction, issueNow: issueNowRunAction, submit: submitRunAction, approve: approveRunAction, generate: generateRunAction };

  return (
    <div className={compact ? "flex justify-end gap-0.5" : "flex flex-wrap gap-2"}>
      {compact ? (
        <>
          <Tooltip content={t("viewRun")}>
            <Button asChild variant="ghost" size="icon-sm" className="text-primary">
              <Link href={`/billing/runs/${id}`} aria-label={t("viewRun")}>
                <Eye aria-hidden />
              </Link>
            </Button>
          </Tooltip>
          {steps.map((s) => {
            const Icon = ICONS[s];
            return (
              <Tooltip key={s} content={t(`steps.${s}`)}>
                <Button variant="ghost" size="icon-sm" className={s === "cancel" ? "text-danger" : undefined} aria-label={t(`steps.${s}`)} onClick={() => setStep(s)}>
                  <Icon aria-hidden />
                </Button>
              </Tooltip>
            );
          })}
        </>
      ) : (
        steps.map((s) => (
          <Button key={s} size="sm" variant={s === "cancel" ? "destructive" : s === "refresh" || s === "submit" ? "outline" : "default"} onClick={() => setStep(s)}>
            {t(`steps.${s}`)}
          </Button>
        ))
      )}
      {!compact && status === "submitted" && isCreator && can.approve && <span className="self-center text-xs text-muted-foreground">{t("needsSomeoneElse")}</span>}
      {!compact && status === "submitted" && !isCreator && can.approve && <GoApprove tab="accounting" />}
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
          if (step === "generate" || step === "issueNow") {
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
