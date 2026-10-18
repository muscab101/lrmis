"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { cn } from "@dhulka/ui/lib/cn";
import { Check, CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { confirmSiteAction, requestSiteCheckAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { SiteCheckStatus } from "@/lib/server/applications";

interface Props {
  application: { id: string; number: string; status: string; site_check_status: SiteCheckStatus | null; site_check_surveyor: string | null };
  me: string;
  can: { request: boolean; checkAny: boolean; checkOwn: boolean };
  /** `full` adds the button labels (application page); tables get icon keys. */
  full?: boolean;
}

const CLOSED = ["approved", "rejected", "cancelled"];

/** The site-check mark (! pending, ✓ confirmed, ✗ not found) and its two actions. */
export function SiteCheckMark({ status }: { status: SiteCheckStatus | null }) {
  const t = useTranslations("applications.siteCheck");
  if (!status) return null;
  const Icon = status === "pending" ? CircleAlert : status === "confirmed" ? CircleCheck : CircleX;
  return (
    <Tooltip content={t(`mark_${status}`)}>
      <span
        role="img"
        aria-label={t(`mark_${status}`)}
        className={cn(
          "inline-flex shrink-0",
          status === "pending" ? "text-status-pending" : status === "confirmed" ? "text-status-approved" : "text-status-rejected",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
    </Tooltip>
  );
}

export function SiteCheckActions({ application: a, me, can, full = false }: Props) {
  const t = useTranslations("applications.siteCheck");
  const [dialog, setDialog] = useState<"request" | "confirm" | null>(null);
  const [note, setNote] = useState("");
  const [exists, setExists] = useState(true);
  const canRequest = can.request && !CLOSED.includes(a.status) && (a.site_check_status === null || a.site_check_status === "not_found");
  const canConfirm = a.site_check_status === "pending" && (can.checkAny || (can.checkOwn && a.site_check_surveyor === me));
  const close = (o: boolean) => {
    if (!o) {
      setDialog(null);
      setNote("");
      setExists(true);
    }
  };
  if (!canRequest && !canConfirm) return null;

  return (
    <>
      {canRequest &&
        (full ? (
          <Button size="sm" variant="outline" onClick={() => setDialog("request")}>
            <CircleAlert className="text-status-pending" aria-hidden />
            {t("request")}
          </Button>
        ) : (
          <Tooltip content={t("request")}>
            <Button variant="ghost" size="icon-sm" className="text-status-pending" aria-label={t("request")} onClick={() => setDialog("request")}>
              <CircleAlert aria-hidden />
            </Button>
          </Tooltip>
        ))}
      {canConfirm &&
        (full ? (
          <Button size="sm" onClick={() => setDialog("confirm")}>
            <Check aria-hidden />
            {t("confirm")}
          </Button>
        ) : (
          <Tooltip content={t("confirm")}>
            <Button variant="ghost" size="icon-sm" className="text-status-approved" aria-label={t("confirm")} onClick={() => setDialog("confirm")}>
              <Check aria-hidden />
            </Button>
          </Tooltip>
        ))}

      <FormDialog
        open={dialog === "request"}
        onOpenChange={close}
        title={t("requestTitle", { number: a.number })}
        description={t("requestBody")}
        confirmLabel={t("request")}
        successMessage={t("requested")}
        submit={() => requestSiteCheckAction({ applicationId: a.id, note })}
      >
        {(fe) => (
          <>
            {fe("siteCheck") && <p className="text-danger text-sm">{fe("siteCheck")}</p>}
            <Field id={`sc-note-${a.id}`} label={t("noteForSurveyor")}>
              <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "confirm"}
        onOpenChange={close}
        title={t("confirmTitle", { number: a.number })}
        description={t("confirmBody")}
        confirmLabel={exists ? t("confirmExists") : t("confirmNotFound")}
        destructive={!exists}
        successMessage={exists ? t("confirmed") : t("reportedNotFound")}
        submit={() => confirmSiteAction({ applicationId: a.id, exists, note })}
      >
        {(fe) => (
          <>
            <div role="radiogroup" aria-label={t("result")} className="grid grid-cols-2 gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={exists === v}
                  onClick={() => setExists(v)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
                    exists === v ? (v ? "border-status-approved bg-status-approved/10" : "border-status-rejected bg-status-rejected/10") : "hover:bg-muted",
                  )}
                >
                  {v ? <CircleCheck className="text-status-approved size-4" aria-hidden /> : <CircleX className="text-status-rejected size-4" aria-hidden />}
                  {v ? t("exists") : t("notFound")}
                </button>
              ))}
            </div>
            <Field id={`sc-result-${a.id}`} label={exists ? t("whatYouSaw") : t("whyNotFound")} error={fe("note")} required={!exists}>
              <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
