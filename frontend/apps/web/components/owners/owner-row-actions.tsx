"use client";

import { Button } from "@dhulka/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { Ellipsis, Info, Pencil, SquareCheckBig, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteOwnerAction, registerOwnerAction } from "@/app/[locale]/(staff)/applications/actions";
import { EditOwner } from "@/app/[locale]/(staff)/owners/[id]/edit-owner";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PartyRow } from "@/lib/server/applications";

export interface OwnerAbilities {
  update: boolean;
  /** Delete partial owners (owners.delete). */
  remove: boolean;
  register: boolean;
  /** Delete registered owners (owners.delete_registered — admins). */
  removeRegistered?: boolean;
}

type Districts = { id: string; name_so: string; name_en: string }[];

/** Row keys: view, edit, delete and move to the register. Registered owners are deleted only by admins. New owners and land are added from Surveys. */
export function OwnerRowActions({ party, districts, can, onDetail = false }: { party: PartyRow; districts: Districts; can: OwnerAbilities; onDetail?: boolean }) {
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "delete" | "register" | null>(null);
  const draft = !party.registered_at;
  const canDelete = draft ? can.remove : !!can.removeRegistered;
  const [reason, setReason] = useState("");

  const icon = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;

  // Phones get one "⋯" menu (in the table only); wider screens get the row of keys.
  const keys = onDetail ? "flex" : "hidden sm:flex";

  return (
    <div className="flex items-center justify-end gap-0.5">
      {!onDetail && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label={t("actions")}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(`/owners/${party.id}`)}>
              <Info aria-hidden />
              {t("actionView")}
            </DropdownMenuItem>
            {can.update && (
              <DropdownMenuItem onSelect={() => setDialog("edit")}>
                <Pencil aria-hidden />
                {tc("edit")}
              </DropdownMenuItem>
            )}
            {draft && can.register && (
              <DropdownMenuItem onSelect={() => setDialog("register")}>
                <SquareCheckBig aria-hidden />
                {t("actionRegister")}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem destructive onSelect={() => setDialog("delete")}>
                <Trash2 aria-hidden />
                {t("actionDelete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {can.update && !onDetail && (
        <EditOwner party={party} districts={districts} hideTrigger open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} />
      )}
      {!onDetail &&
        icon(
          t("actionView"),
          <Button asChild variant="ghost" size="icon-sm" className={`text-status-partial ${keys}`}>
            <Link href={`/owners/${party.id}`} aria-label={t("actionView")}>
              <Info aria-hidden />
            </Link>
          </Button>,
        )}
      {can.update && (onDetail ? <EditOwner party={party} districts={districts} /> : <EditOwner party={party} districts={districts} iconOnly className="hidden sm:inline-flex" />)}
      {canDelete &&
        icon(
          t("actionDelete"),
          <Button variant="ghost" size="icon-sm" className={`text-danger ${keys}`} aria-label={t("actionDelete")} onClick={() => setDialog("delete")}>
            <Trash2 aria-hidden />
          </Button>,
        )}
      {draft &&
        can.register &&
        icon(
          t("actionRegister"),
          <Button variant="ghost" size="icon-sm" className={`text-success ${keys}`} aria-label={t("actionRegister")} onClick={() => setDialog("register")}>
            <SquareCheckBig aria-hidden />
          </Button>,
        )}

      <FormDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteTitle", { name: party.full_name })}
        description={draft ? t("deleteBody") : t("deleteBodyRegistered")}
        confirmLabel={t("actionDelete")}
        destructive
        submit={() => deleteOwnerAction({ id: party.id, reason })}
        successMessage={t("deleted")}
        onDone={() => onDetail && router.push("/owners")}
      >
        {(fe) => (
          <>
            {!draft && (
              <Field id={`owner-delete-${party.id}`} label={t("deleteReason")} error={fe("reason")} required>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
            )}
            {fe("owner") && <p className="text-danger text-sm">{fe("owner")}</p>}
          </>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "register"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("registerTitle", { name: party.full_name })}
        description={t("registerBody")}
        confirmLabel={t("actionRegister")}
        submit={() => registerOwnerAction({ id: party.id })}
        successMessage={t("registeredDone")}
      >
        {(fe) => fe("owner") && <p className="text-danger text-sm">{fe("owner")}</p>}
      </FormDialog>
    </div>
  );
}
