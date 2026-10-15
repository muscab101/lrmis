"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Ban, Undo2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { transitionApplicationAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

type Action = "return" | "reject" | "cancel";

/** Return (with reason), reject (with reason) or cancel — each recorded in the history. */
export function DecisionPanel({ applicationId, allowed }: { applicationId: string; allowed: Action[] }) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  if (allowed.length === 0) return null;
  const icon = { return: <Undo2 aria-hidden />, reject: <XCircle aria-hidden />, cancel: <Ban aria-hidden /> };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {allowed.map((a) => (
          <Button key={a} variant={a === "return" ? "outline" : "destructive"} size="sm" onClick={() => setAction(a)}>
            {icon[a]}
            {t(`actions.${a}`)}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAction(null);
            setNote("");
            setError(null);
          }
        }}
        title={action ? t(`actions.${action}Title`) : ""}
        description={action ? t(`actions.${action}Body`) : ""}
        confirmLabel={action ? t(`actions.${action}`) : ""}
        cancelLabel={tc("cancel")}
        destructive={action !== "return"}
        loading={busy}
        onConfirm={async () => {
          if (!action) return;
          setBusy(true);
          setError(null);
          const res = await transitionApplicationAction({ applicationId, action, note });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          toast.success(t(`actions.${action}Done`));
          setAction(null);
          setNote("");
          router.refresh();
        }}
      >
        <FormError error={error && !error.fieldErrors ? error : null} />
        <Field id="note" label={action === "cancel" ? t("noteOptional") : t("reason")} error={vm(error?.fieldErrors?.note?.[0])} required={action !== "cancel"}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
