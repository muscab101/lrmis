"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { BadgeCheck, Inbox, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cancelDocumentAction, decideReprintAction, issueCertificateAction, requestReprintAction } from "@/app/[locale]/(staff)/documents/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { ReprintRow } from "@/lib/server/certificates";

export function IssueCertificateButton({ parcelId, pun, size = "sm" }: { parcelId: string; pun: string; size?: "sm" | "default" }) {
  const t = useTranslations("documents");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <BadgeCheck aria-hidden />
        {t("issue")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("issueTitle")}
        description={t("issueBody", { pun })}
        confirmLabel={t("issue")}
        submit={() => issueCertificateAction({ parcelId })}
        onDone={(d) => toast.success(t("issued", { cards: (d as { id_cards: number }).id_cards }))}
      />
    </>
  );
}

export function DocumentActions({ id, status, can }: { id: string; status: string; can: { reprint: boolean; cancel: boolean } }) {
  const t = useTranslations("documents");
  const [dialog, setDialog] = useState<null | "reprint" | "cancel">(null);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/documents/${id}/print`} target="_blank">
          <Printer aria-hidden />
          {t("openPrint")}
        </Link>
      </Button>
      {status === "valid" && can.reprint && (
        <Button size="sm" variant="outline" onClick={() => setDialog("reprint")}>
          {t("requestReprint")}
        </Button>
      )}
      {status === "valid" && can.cancel && (
        <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
          {t("cancelDocument")}
        </Button>
      )}
      <FormDialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setReason("");
          }
        }}
        title={dialog === "cancel" ? t("cancelTitle") : t("requestReprint")}
        description={dialog === "cancel" ? t("cancelBody") : t("reprintBody")}
        confirmLabel={dialog === "cancel" ? t("cancelDocument") : t("submitRequest")}
        destructive={dialog === "cancel"}
        successMessage={dialog === "cancel" ? t("cancelled") : t("reprintRequested")}
        submit={() => (dialog === "cancel" ? cancelDocumentAction({ id, reason }) : requestReprintAction({ id, reason }))}
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

export function ReprintQueue({ rows, me, canDecide }: { rows: ReprintRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("documents");
  const [target, setTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noReprints")} description={t("noReprintsBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("document")}</TableHead>
            <TableHead>PUN</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("fee")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/documents/${r.document?.id}`} className="hover:text-primary">
                  <Mono>{r.document?.serial}</Mono>
                </Link>
              </TableCell>
              <TableCell>
                <Mono>{r.document?.parcel?.pun}</Mono>
              </TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-sm">
                {r.fee_invoice ? (
                  <Link href={`/invoices/${r.fee_invoice.id}`} className="underline">
                    <Mono>{r.fee_invoice.number}</Mono> · {t(`feeStatus.${r.fee_invoice.status === "paid" ? "paid" : "unpaid"}`)}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-sm">{t(`decision.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="text-end whitespace-nowrap">
                  {r.status === "pending" && r.requested_by !== me && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, approve: false })}>
                        {t("reject")}
                      </Button>
                      <Button size="sm" onClick={() => setTarget({ id: r.id, approve: true })}>
                        {t("approve")}
                      </Button>
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setNote("");
          }
        }}
        title={target?.approve ? t("approveReprint") : t("rejectReprint")}
        description={target?.approve ? t("approveReprintBody") : ""}
        confirmLabel={target?.approve ? t("approve") : t("reject")}
        destructive={target ? !target.approve : false}
        successMessage={t("decided")}
        submit={() => decideReprintAction({ id: target!.id, approve: target!.approve, note })}
      >
        {(fe) => (
          <Field id="note" label={target?.approve ? t("noteOptional") : t("reason")} error={fe("note")} required={!target?.approve}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
