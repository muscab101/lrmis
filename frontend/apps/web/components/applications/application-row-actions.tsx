"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { Info, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { transitionApplicationAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { SiteCheckStatus } from "@/lib/server/applications";
import { SiteCheckActions } from "./site-check";

interface Row {
  id: string;
  number: string;
  status: string;
  created_by?: string | null;
  site_check_status: SiteCheckStatus | null;
  site_check_surveyor: string | null;
}

interface Can {
  update: boolean;
  cancel: boolean;
  checkAny: boolean;
  checkOwn: boolean;
}

const EDITABLE = ["draft", "returned"];
const DELETABLE = ["draft", "awaiting_payment", "returned"];

/**
 * The application staff's keys: view, edit (while it can still change), site check (! / ✓) and
 * delete. Delete cancels the application; it stays in the records. New land is added from Surveys.
 */
export function ApplicationRowActions({ application: a, me, can }: { application: Row; me: string; can: Can }) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState("");
  const canEdit = can.update && EDITABLE.includes(a.status);
  const canDelete = DELETABLE.includes(a.status) && (can.cancel || a.created_by === me);
  const key = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;

  return (
    <div className="flex items-center justify-end gap-0.5">
      {key(
        t("rowView"),
        <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
          <Link href={`/applications/${a.id}`} aria-label={t("rowView")}>
            <Info aria-hidden />
          </Link>
        </Button>,
      )}
      {canEdit &&
        key(
          tc("edit"),
          <Button asChild variant="ghost" size="icon-sm" className="text-success">
            <Link href={`/applications/${a.id}?tab=details`} aria-label={tc("edit")}>
              <Pencil aria-hidden />
            </Link>
          </Button>,
        )}
      <SiteCheckActions application={a} me={me} can={{ request: can.update, checkAny: can.checkAny, checkOwn: can.checkOwn }} />
      {canDelete &&
        key(
          t("rowDelete"),
          <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("rowDelete")} onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden />
          </Button>,
        )}
      <FormDialog
        open={deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(false);
            setNote("");
          }
        }}
        title={t("rowDeleteTitle", { number: a.number })}
        description={t("rowDeleteBody")}
        confirmLabel={t("rowDelete")}
        destructive
        successMessage={t("actions.cancelDone")}
        submit={() => transitionApplicationAction({ applicationId: a.id, action: "cancel", note })}
      >
        {(fe) => (
          <Field id={`del-note-${a.id}`} label={t("noteOptional")} error={fe("note")}>
            <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}
