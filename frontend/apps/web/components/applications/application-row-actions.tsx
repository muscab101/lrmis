"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { toast } from "@dhulka/ui/toaster";
import { Info, Landmark, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteApplicationAction, registerConfirmedAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { SiteCheckStatus } from "@/lib/server/applications";
import { SiteCheckActions } from "./site-check";

interface Row {
  id: string;
  number: string;
  status: string;
  created_by?: string | null;
  site_check_status: SiteCheckStatus | null;
  site_check_surveyor: string | null;
  land_use?: string | null;
}

interface Can {
  update: boolean;
  cancel: boolean;
  checkAny: boolean;
  checkOwn: boolean;
  /** parcels.approve: move to Parcels after the ✓ site check. */
  register: boolean;
}

const EDITABLE = ["draft", "returned"];
/** Delete removes it from the database; land under survey or registered can't be deleted. */
const DELETABLE = ["draft", "awaiting_payment", "returned", "in_survey", "surveyed", "cancelled", "rejected"];
const CLOSED = ["approved", "rejected", "cancelled"];
const LAND_USES = ["residential", "commercial", "mixed", "state", "agricultural", "other"] as const;

/**
 * The application staff's keys: view, edit (while it can still change), site check (? / ✓),
 * move to Parcels (after ✓, Registrar) and delete. Delete cancels the application; it stays in the records. New land is added from Surveys.
 */
export function ApplicationRowActions({ application: a, me, can }: { application: Row; me: string; can: Can }) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const [deleting, setDeleting] = useState(false);
  const ts = useTranslations("stage");
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [landUse, setLandUse] = useState<(typeof LAND_USES)[number]>(
    (LAND_USES as readonly string[]).includes(a.land_use ?? "") ? (a.land_use as (typeof LAND_USES)[number]) : "residential",
  );
  const [regNote, setRegNote] = useState("");
  // The site check is optional; only "no land found" stops registration.
  const showRegister = can.register && a.site_check_status !== "not_found" && !CLOSED.includes(a.status);
  // Why it can't be moved yet (the database checks the same; this just says so up front).
  const registerBlocker = !showRegister
    ? null
    : ["draft", "returned"].includes(a.status)
      ? "register_not_submitted"
      : null; // payment comes after registration
  const tv = useTranslations("validation");
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
      {showRegister &&
        key(
          registerBlocker ? `${t("rowRegister")}: ${tv(registerBlocker)}` : t("rowRegister"),
          // A disabled button can't show a tooltip, so the wrapper carries it.
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-primary"
              aria-label={registerBlocker ? `${t("rowRegister")}: ${tv(registerBlocker)}` : t("rowRegister")}
              disabled={!!registerBlocker}
              onClick={() => setRegistering(true)}
            >
              <Landmark aria-hidden />
            </Button>
          </span>,
        )}
      {canDelete &&
        key(
          t("rowDelete"),
          <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("rowDelete")} onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden />
          </Button>,
        )}
      <FormDialog
        open={registering}
        onOpenChange={(o) => {
          if (!o) {
            setRegistering(false);
            setRegNote("");
          }
        }}
        title={t("rowRegisterTitle", { number: a.number })}
        description={t("rowRegisterBody")}
        confirmLabel={t("rowRegister")}
        submit={() => registerConfirmedAction({ applicationId: a.id, landUse, note: regNote })}
        onDone={(d) => {
          const r = d as { pun: string; parcel_id: string };
          toast.success(t("rowRegistered", { pun: r.pun }));
          router.push(`/parcels/${r.parcel_id}`);
        }}
      >
        {(fe) => (
          <>
            {fe("register") && <p className="text-danger text-sm">{fe("register")}</p>}
            <Field id={`reg-use-${a.id}`} label={ts("landUse")}>
              <NativeSelect value={landUse} onChange={(e) => setLandUse(e.target.value as (typeof LAND_USES)[number])}>
                {LAND_USES.map((u) => (
                  <option key={u} value={u}>
                    {ts(`landUses.${u}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`reg-note-${a.id}`} label={t("noteOptional")}>
              <Textarea rows={2} value={regNote} maxLength={1000} onChange={(e) => setRegNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
      <FormDialog
        open={deleting}
        onOpenChange={(o) => !o && setDeleting(false)}
        title={t("rowDeleteTitle", { number: a.number })}
        description={t("rowDeleteBody")}
        confirmLabel={t("rowDelete")}
        destructive
        successMessage={t("rowDeleted")}
        submit={() => deleteApplicationAction({ applicationId: a.id })}
      />
    </div>
  );
}
