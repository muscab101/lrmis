"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cancelTransferAction, decideTransferAction, submitTransferAction } from "@/app/[locale]/(staff)/transfers/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import { DecideButtons } from "./decide";
import { NoteAction } from "./note-action";

export function TransferActions({ id, status, mine, can }: { id: string; status: string; mine: boolean; can: { create: boolean; approve: boolean } }) {
  const t = useTranslations("legal");
  const tc = useTranslations("common");
  const router = useRouter();
  const em = useErrorMessage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = status === "draft" || status === "submitted";
  if (!open) return null;
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
              setBusy(true);
              const r = await submitTransferAction({ id });
              setBusy(false);
              setConfirm(false);
              if (r.ok) {
                toast.success(t("submitted"));
                router.refresh();
              } else toast.error(em(r.error));
            }}
          />
        </>
      )}
      {status === "submitted" && can.approve && !mine && <DecideButtons decide={(v) => decideTransferAction({ id, approve: v.approve, note: v.note })} />}
      {can.create && (
        <NoteAction label={t("cancelTransfer")} title={t("cancelTransfer")} noteLabel={t("reason")} variant="ghost" destructive success={t("cancelled")} submit={(n) => cancelTransferAction({ id, note: n })} />
      )}
    </div>
  );
}
