"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { Ban, Eye, Printer, RotateCcw, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cancelDocumentAction, reprintDirectAction, requestReprintAction } from "@/app/[locale]/(staff)/documents/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { usePrintNow } from "@/components/documents/use-print-now";
import { Link, useRouter } from "@/i18n/navigation";

type Dialog = "reprint" | "direct" | "cancel";

/** A document's keys on the ID cards and Certificates lists: view, print, ask for a reprint, reprint now (super admin), cancel. */
export function CardRowActions({
  id,
  serial,
  status,
  can,
  kind = "id_card",
}: {
  id: string;
  serial: string;
  status: string;
  can: { reprint: boolean; direct: boolean; cancel: boolean; print?: boolean };
  kind?: "id_card" | "certificate";
}) {
  const t = useTranslations("documents");
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const printing = usePrintNow();
  const [reason, setReason] = useState("");
  const valid = status === "valid";
  const key = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;
  const viewLabel = kind === "certificate" ? t("certificateView") : t("cardView");
  const copy: Record<Dialog, { title: string; body: string; confirm: string; success: string }> = {
    reprint: { title: t("requestReprint"), body: t("reprintBody"), confirm: t("submitRequest"), success: t("reprintRequested") },
    direct: { title: t("directTitle"), body: t("directBody"), confirm: t("directConfirm"), success: t("directDone") },
    cancel: { title: t("cancelTitle"), body: t("cancelBody"), confirm: t("cancelDocument"), success: t("cancelled") },
  };
  return (
    <div className="flex justify-end gap-0.5">
      {key(
        viewLabel,
        <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
          <Link href={`/documents/${id}`} aria-label={viewLabel}>
            <Eye aria-hidden />
          </Link>
        </Button>,
      )}
      {valid &&
        can.print &&
        key(
          t("printNow"),
          <Button variant="ghost" size="icon-sm" aria-label={t("printNow")} loading={printing.busy} onClick={() => void printing.print([id])}>
            <Printer aria-hidden />
          </Button>,
        )}
      {valid &&
        can.reprint &&
        key(
          t("requestReprint"),
          <Button variant="ghost" size="icon-sm" aria-label={t("requestReprint")} onClick={() => setDialog("reprint")}>
            <RotateCcw aria-hidden />
          </Button>,
        )}
      {valid &&
        can.direct &&
        key(
          t("directReprint"),
          <Button variant="ghost" size="icon-sm" aria-label={t("directReprint")} onClick={() => setDialog("direct")}>
            <Zap aria-hidden />
          </Button>,
        )}
      {valid &&
        can.cancel &&
        key(
          t("cancelDocument"),
          <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("cancelDocument")} onClick={() => setDialog("cancel")}>
            <Ban aria-hidden />
          </Button>,
        )}
      <FormDialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setReason("");
          }
        }}
        title={dialog ? `${copy[dialog].title} · ${serial}` : ""}
        description={dialog ? copy[dialog].body : ""}
        confirmLabel={dialog ? copy[dialog].confirm : ""}
        destructive={dialog === "cancel"}
        successMessage={dialog ? copy[dialog].success : undefined}
        submit={() =>
          dialog === "cancel" ? cancelDocumentAction({ id, reason }) : dialog === "direct" ? reprintDirectAction({ id, reason }) : requestReprintAction({ id, reason })
        }
        onDone={(d) => {
          const next = (d as { document_id?: string } | null)?.document_id;
          if (dialog === "direct" && next) router.push(`/documents/${next}`);
        }}
      >
        {(fe) => (
          <Field id={`reason-${id}`} label={t("reason")} error={fe("reason")} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}
