"use client";

import type { ActionResult, AppError } from "@dhulka/core/errors";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Runs the server action. */
  submit: () => Promise<ActionResult<unknown>>;
  /** Toast shown on success. */
  successMessage?: string;
  onDone?: (data: unknown) => void;
  /** Fields; `fe(name)` gives the translated error for a field. */
  children?: (fe: (name: string) => string | undefined) => React.ReactNode;
}

/** Confirm-style dialog around a server action: busy state, form-level error, field errors, refresh on success. */
export function FormDialog({ open, onOpenChange, title, description, confirmLabel, destructive, submit, successMessage, onDone, children }: Props) {
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const fe = (name: string) => vm(error?.fieldErrors?.[name]?.[0]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={tc("cancel")}
      destructive={destructive}
      loading={busy}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        const res = await submit();
        setBusy(false);
        if (!res.ok) return setError(res.error);
        if (successMessage) toast.success(successMessage);
        onOpenChange(false);
        onDone?.(res.data);
        router.refresh();
      }}
    >
      <FormError error={error && !error.fieldErrors ? error : null} />
      {children && <div className="space-y-3">{children(fe)}</div>}
    </ConfirmDialog>
  );
}
