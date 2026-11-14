"use client";

import { Button } from "@dhulka/ui/button";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  assessParcelAction,
  deleteAssessmentAction,
} from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { AssessmentRow } from "@/lib/server/valuation";


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

