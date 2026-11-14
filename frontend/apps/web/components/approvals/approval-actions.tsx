"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { Check, Eye, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { decideApprovalAction } from "@/app/[locale]/(staff)/applications/inbox-actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { ApprovalKind } from "@/lib/server/approvals";

/** One item's keys: open it, approve it, turn it down (with a reason). */
export function ApprovalActions({
  kind,
  id,
  href,
  label,
  canReject,
  canApprove,
  extra = null,
}: {
  /** What this kind needs to be approved (desk payments: cashier and days). */
  extra?: Record<string, string> | null;
  kind: ApprovalKind;
  id: string;
  href: string;
  /** What is being decided (shown in the question). */
  label: string;
  canReject: boolean;
  canApprove: boolean;
}) {
  const t = useTranslations("approvals");
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const key = (text: string, node: React.ReactElement) => <Tooltip content={text}>{node}</Tooltip>;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {key(
        t("open"),
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={href} aria-label={t("open")}>
            <Eye aria-hidden />
          </Link>
        </Button>,
      )}
      {canApprove && (
        <Button size="sm" variant="ghost" className="text-primary hover:text-primary ms-1 h-8" onClick={() => setDialog("approve")}>
          <Check aria-hidden />
          {t("approve")}
        </Button>
      )}
      {canReject &&
        key(
          t("reject"),
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("reject")} onClick={() => setDialog("reject")}>
            <X aria-hidden />
          </Button>,
        )}
      <FormDialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setNote("");
          }
        }}
        title={dialog === "reject" ? t("rejectTitle", { what: label }) : t("approveTitle", { what: label })}
        description={dialog === "reject" ? t("rejectBody") : t(`approveBody.${kind}`)}
        confirmLabel={dialog === "reject" ? t("reject") : t("approve")}
        destructive={dialog === "reject"}
        successMessage={dialog === "reject" ? t("rejected") : t("approved")}
        submit={() =>
          decideApprovalAction({
            kind: kind as Parameters<typeof decideApprovalAction>[0]["kind"],
            id,
            approve: dialog === "approve",
            note,
            extra: extra ?? {},
          })
        }
      >
        {(fe) => (
          <>
            {canReject && (
              <Field id={`note-${id}`} label={dialog === "reject" ? t("reason") : t("noteOptional")} error={fe("note")} required={dialog === "reject"}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
          </>
        )}
      </FormDialog>
    </div>
  );
}
