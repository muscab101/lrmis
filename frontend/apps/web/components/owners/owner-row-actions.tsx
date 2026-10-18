"use client";

import { Button } from "@dhulka/ui/button";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Info, Plus, SquareCheckBig, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteOwnerAction, registerOwnerAction } from "@/app/[locale]/(staff)/applications/actions";
import { EditOwner } from "@/app/[locale]/(staff)/owners/[id]/edit-owner";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PartyRow } from "@/lib/server/applications";

export interface OwnerAbilities {
  apply: boolean;
  update: boolean;
  remove: boolean;
  register: boolean;
}

type Districts = { id: string; name_so: string; name_en: string }[];

/** The old system's row keys: add a parcel, view, edit, delete, move to the register. */
export function OwnerRowActions({ party, districts, can, onDetail = false }: { party: PartyRow; districts: Districts; can: OwnerAbilities; onDetail?: boolean }) {
  const t = useTranslations("owners");
  const router = useRouter();
  const [dialog, setDialog] = useState<"delete" | "register" | null>(null);
  const draft = !party.registered_at;

  const icon = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;

  return (
    <div className="flex items-center justify-end gap-0.5">
      {can.apply &&
        icon(
          t("actionAddParcel"),
          <Button asChild variant="ghost" size="icon-sm" className="text-primary">
            <Link href={`/applications/new?owner=${party.id}`} aria-label={t("actionAddParcel")}>
              <Plus aria-hidden />
            </Link>
          </Button>,
        )}
      {!onDetail &&
        icon(
          t("actionView"),
          <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
            <Link href={`/owners/${party.id}`} aria-label={t("actionView")}>
              <Info aria-hidden />
            </Link>
          </Button>,
        )}
      {can.update && <EditOwner party={party} districts={districts} iconOnly={!onDetail} />}
      {draft &&
        can.remove &&
        icon(
          t("actionDelete"),
          <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("actionDelete")} onClick={() => setDialog("delete")}>
            <Trash2 aria-hidden />
          </Button>,
        )}
      {draft &&
        can.register &&
        icon(
          t("actionRegister"),
          <Button variant="ghost" size="icon-sm" className="text-success" aria-label={t("actionRegister")} onClick={() => setDialog("register")}>
            <SquareCheckBig aria-hidden />
          </Button>,
        )}

      <FormDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteTitle", { name: party.full_name })}
        description={t("deleteBody")}
        confirmLabel={t("actionDelete")}
        destructive
        submit={() => deleteOwnerAction({ id: party.id })}
        successMessage={t("deleted")}
        onDone={() => onDetail && router.push("/owners")}
      >
        {(fe) => fe("owner") && <p className="text-danger text-sm">{fe("owner")}</p>}
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
