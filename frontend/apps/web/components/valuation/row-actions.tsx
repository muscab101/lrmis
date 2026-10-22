"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  assessParcelAction,
  deleteAppealAction,
  deleteAssessmentAction,
  deleteExemptionAction,
  updateAppealAction,
  updateExemptionAction,
} from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { AppealRow, AssessmentRow, ExemptionRow } from "@/lib/server/valuation";

const KINDS = ["mosque", "school", "hospital", "government", "hardship", "other"] as const;

/** The edit (pencil) and delete (bin) keys at the end of a row. */
export function EditDeleteKeys({ onEdit, onDelete, editLabel }: { onEdit?: () => void; onDelete?: () => void; editLabel?: string }) {
  const t = useTranslations("valuation");
  return (
    <span className="inline-flex justify-end gap-0.5">
      {onEdit && (
        <Button size="icon-sm" variant="ghost" className="text-success" aria-label={editLabel ?? t("edit")} title={editLabel ?? t("edit")} onClick={onEdit}>
          <Pencil aria-hidden />
        </Button>
      )}
      {onDelete && (
        <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={t("delete")} title={t("delete")} onClick={onDelete}>
          <Trash2 aria-hidden />
        </Button>
      )}
    </span>
  );
}

/** Confirm-and-delete dialog shared by the tabs. */
export function DeleteDialog({ open, onOpenChange, title, body, submit }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; submit: () => Promise<unknown> }) {
  const t = useTranslations("valuation");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      confirmLabel={t("delete")}
      destructive
      successMessage={t("deleted")}
      submit={submit as never}
    />
  );
}

/** Assessments: re-assess with today's rates (the update), or delete the live one. */
export function AssessmentRowActions({ row, canReassess, canDelete }: { row: AssessmentRow; canReassess: boolean; canDelete: boolean }) {
  const t = useTranslations("valuation");
  const [dialog, setDialog] = useState<"reassess" | "delete" | null>(null);
  if (row.status !== "issued" || !row.parcel) return null;
  const parcelId = row.parcel.id;
  return (
    <>
      <span className="inline-flex justify-end gap-0.5">
        {canReassess && (
          <Button size="icon-sm" variant="ghost" className="text-success" aria-label={t("reassess")} title={t("reassess")} onClick={() => setDialog("reassess")}>
            <RefreshCw aria-hidden />
          </Button>
        )}
        {canDelete && <EditDeleteKeys onDelete={() => setDialog("delete")} />}
      </span>
      <FormDialog
        open={dialog === "reassess"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("reassessTitle", { number: row.number })}
        description={t("reassessBody", { year: row.year })}
        confirmLabel={t("reassess")}
        successMessage={t("saved")}
        submit={() => assessParcelAction({ parcelId, year: row.year })}
      />
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteAssessmentTitle", { number: row.number })}
        body={t("deleteAssessmentBody")}
        submit={() => deleteAssessmentAction({ id: row.id })}
      />
    </>
  );
}

/** Exemptions: edit or delete while pending. */
export function ExemptionRowActions({ row }: { row: ExemptionRow }) {
  const t = useTranslations("valuation");
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const start = () => ({ kind: row.kind as (typeof KINDS)[number], pct: String(row.pct), reason: row.reason, validFrom: row.valid_from, validTo: row.valid_to ?? "" });
  const [v, setV] = useState(start);
  if (row.status !== "pending") return null;
  return (
    <>
      <EditDeleteKeys
        onEdit={() => {
          setV(start());
          setDialog("edit");
        }}
        onDelete={() => setDialog("delete")}
      />
      <FormDialog
        open={dialog === "edit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("editExemption")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => updateExemptionAction({ id: row.id, ...v })}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id={`ex-kind-${row.id}`} label={t("exemptionKind")}>
                <NativeSelect value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as (typeof KINDS)[number] })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`exemptionKinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`ex-pct-${row.id}`} label="%" error={fe("pct")} required>
                <Input type="number" min={1} max={100} step="0.01" value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} />
              </Field>
              <Field id={`ex-from-${row.id}`} label={t("validFrom")} error={fe("validFrom")} required>
                <Input type="date" value={v.validFrom} onChange={(e) => setV({ ...v, validFrom: e.target.value })} />
              </Field>
              <Field id={`ex-to-${row.id}`} label={t("validTo")} error={fe("validTo")}>
                <Input type="date" value={v.validTo} onChange={(e) => setV({ ...v, validTo: e.target.value })} />
              </Field>
            </div>
            <Field id={`ex-reason-${row.id}`} label={t("reason")} error={fe("reason")} required>
              <Textarea rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteExemptionTitle")}
        body={t("deleteExemptionBody")}
        submit={() => deleteExemptionAction({ id: row.id })}
      />
    </>
  );
}

/** Appeals: edit or delete while open. */
export function AppealRowActions({ row }: { row: AppealRow }) {
  const t = useTranslations("valuation");
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [reason, setReason] = useState(row.reason);
  const [requested, setRequested] = useState(row.requested_total != null ? String(row.requested_total) : "");
  if (row.status !== "open") return null;
  return (
    <>
      <EditDeleteKeys
        onEdit={() => {
          setReason(row.reason);
          setRequested(row.requested_total != null ? String(row.requested_total) : "");
          setDialog("edit");
        }}
        onDelete={() => setDialog("delete")}
      />
      <FormDialog
        open={dialog === "edit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("editAppeal")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => updateAppealAction({ id: row.id, reason, requestedTotal: requested.trim() === "" ? null : Number(requested) })}
      >
        {(fe) => (
          <>
            <Field id={`ap-reason-${row.id}`} label={t("reason")} error={fe("reason")} required>
              <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field id={`ap-req-${row.id}`} label={t("requested")} error={fe("requestedTotal")}>
              <Input type="number" min={0} step="0.01" value={requested} onChange={(e) => setRequested(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteAppealTitle", { number: row.assessment?.number ?? "" })}
        body={t("deleteAppealBody")}
        submit={() => deleteAppealAction({ id: row.id })}
      />
    </>
  );
}
