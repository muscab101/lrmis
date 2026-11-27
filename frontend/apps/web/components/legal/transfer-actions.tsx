"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cancelTransferAction, decideTransferAction, reviewTransferAction, submitTransferAction } from "@/app/[locale]/(staff)/transfers/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import { NoteAction } from "./note-action";

/**
 * What can be done with a transfer now. Draft: submit or cancel. Submitted: an approver starts the review, asks for
 * more documents, approves or rejects (with a reason); ownership changes only on approval.
 */
export function TransferActions({
  id,
  status,
  review,
  can,
}: {
  id: string;
  status: string;
  review?: "under_review" | "needs_documents" | null;
  can: { create: boolean; approve: boolean };
}) {
  const t = useTranslations("legal");
  const tr = useTranslations("legal.review");
  const tc = useTranslations("common");
  const router = useRouter();
  const em = useErrorMessage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = status === "draft" || status === "submitted";
  if (!open) return null;
  const run = async (fn: () => Promise<{ ok: boolean; error?: Parameters<typeof em>[0] }>, ok: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      toast.success(ok);
      router.refresh();
    } else if (r.error) toast.error(em(r.error));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && can.create && (
        <>
          <Button size="sm" onClick={() => setConfirm(true)}>
            {t("submitForApproval")}
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={t("submitForApproval")}
            description={t("submitBody")}
            confirmLabel={t("submit")}
            cancelLabel={tc("cancel")}
            loading={busy}
            onConfirm={async () => {
              await run(() => submitTransferAction({ id }), t("submitted"));
              setConfirm(false);
            }}
          />
        </>
      )}
      {status === "submitted" && can.approve && (
        <>
          {review !== "under_review" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => reviewTransferAction({ id, action: "start", note: "" }), tr("started"))}>
              {tr("start")}
            </Button>
          )}
          <NoteAction
            label={tr("requestDocuments")}
            title={tr("requestDocuments")}
            description={tr("requestDocumentsBody")}
            noteLabel={tr("whatIsNeeded")}
            success={tr("requested")}
            submit={(n) => reviewTransferAction({ id, action: "request_documents", note: n })}
          />
          {review !== "needs_documents" && (
            <NoteAction
              label={tr("approve")}
              title={tr("approveTitle")}
              description={tr("approveBody")}
              noteLabel={tr("comment")}
              required={false}
              variant="default"
              success={tr("approved")}
              submit={(n) => decideTransferAction({ id, approve: true, note: n })}
            />
          )}
          <NoteAction
            label={tr("reject")}
            title={tr("reject")}
            noteLabel={tr("rejectReason")}
            destructive
            variant="outline"
            success={tr("rejected")}
            submit={(n) => decideTransferAction({ id, approve: false, note: n })}
          />
        </>
      )}
      {can.create && (
        <NoteAction label={t("cancelTransfer")} title={t("cancelTransfer")} noteLabel={t("reason")} variant="ghost" destructive success={t("cancelled")} submit={(n) => cancelTransferAction({ id, note: n })} />
      )}
    </div>
  );
}
