"use client";

import { Button } from "@dhulka/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { BadgeCheck, Ellipsis, Info, Lock, LockOpen, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteParcelAction, lockParcelAction, registerParcelAction, unlockParcelAction, updateParcelDetailsAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";

export interface ParcelRowAbilities {
  update: boolean;
  lock: boolean;
  /** Move partial land to Registered (parcels.approve). */
  register?: boolean;
  /** Delete this land: partial land with parcels.delete, registered land with parcels.delete_registered. */
  delete?: boolean;
}

interface ParcelBits {
  id: string;
  pun: string | null;
  house_no: string | null;
  govt_receipt_no: string | null;
  plot_no?: string | null;
  locked_at: string | null;
  status?: string;
}

/** View, edit (House No, Govt. Receipt, plot), register (partial land), delete, and lock / unlock. Phones get one "⋯" menu in tables. */
export function ParcelRowActions({ parcel, can, onDetail = false }: { parcel: ParcelBits; can: ParcelRowAbilities; onDetail?: boolean }) {
  const t = useTranslations("parcels");
  const tc = useTranslations("common");
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "lock" | "unlock" | "register" | "delete" | null>(null);
  const [v, setV] = useState({ houseNo: parcel.house_no ?? "", govtReceiptNo: parcel.govt_receipt_no ?? "", plotNo: parcel.plot_no ?? "" });
  const [reason, setReason] = useState("");
  const locked = !!parcel.locked_at;
  const partial = parcel.status === "draft" || parcel.status === "surveyed" || parcel.status === "verified";
  const canRegister = !!can.register && partial && !locked;
  const canDelete = !!can.delete && !locked;
  const name = parcel.pun ?? t("noPun");
  const keys = onDetail ? "flex" : "hidden sm:flex";
  const close = (o: boolean) => {
    if (!o) {
      setDialog(null);
      setReason("");
    }
  };
  const key = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;

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
            <DropdownMenuItem onSelect={() => router.push(`/parcels/${parcel.id}`)}>
              <Info aria-hidden />
              {t("actionView")}
            </DropdownMenuItem>
            {can.update && !locked && (
              <DropdownMenuItem onSelect={() => setDialog("edit")}>
                <Pencil aria-hidden />
                {tc("edit")}
              </DropdownMenuItem>
            )}
            {canRegister && (
              <DropdownMenuItem onSelect={() => setDialog("register")}>
                <BadgeCheck aria-hidden />
                {t("fieldLand.register")}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem onSelect={() => setDialog("delete")}>
                <Trash2 aria-hidden />
                {tc("delete")}
              </DropdownMenuItem>
            )}
            {can.lock && (
              <DropdownMenuItem onSelect={() => setDialog(locked ? "unlock" : "lock")}>
                {locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
                {locked ? t("actionUnlock") : t("actionLock")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {can.update &&
        !locked &&
        key(
          tc("edit"),
          <Button variant="ghost" size="icon-sm" className={`text-success ${keys}`} aria-label={tc("edit")} onClick={() => setDialog("edit")}>
            <Pencil aria-hidden />
          </Button>,
        )}
      {!onDetail &&
        key(
          t("actionView"),
          <Button asChild variant="ghost" size="icon-sm" className={`text-status-partial ${keys}`}>
            <Link href={`/parcels/${parcel.id}`} aria-label={t("actionView")}>
              <Info aria-hidden />
            </Link>
          </Button>,
        )}
      {canRegister &&
        key(
          t("fieldLand.register"),
          <Button variant="ghost" size="icon-sm" className={`text-primary ${keys}`} aria-label={t("fieldLand.register")} onClick={() => setDialog("register")}>
            <BadgeCheck aria-hidden />
          </Button>,
        )}
      {canDelete &&
        key(
          tc("delete"),
          <Button variant="ghost" size="icon-sm" className={`text-danger ${keys}`} aria-label={tc("delete")} onClick={() => setDialog("delete")}>
            <Trash2 aria-hidden />
          </Button>,
        )}
      {can.lock &&
        key(
          locked ? t("actionUnlock") : t("actionLock"),
          <Button
            variant="ghost"
            size="icon-sm"
            className={`${locked ? "text-danger" : "text-muted-foreground"} ${keys}`}
            aria-label={locked ? t("actionUnlock") : t("actionLock")}
            onClick={() => setDialog(locked ? "unlock" : "lock")}
          >
            {locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
          </Button>,
        )}

      <FormDialog
        open={dialog === "edit"}
        onOpenChange={close}
        title={t("editTitle", { pun: name })}
        description={t("editBody")}
        confirmLabel={tc("saveChanges")}
        successMessage={tc("saved")}
        submit={() => updateParcelDetailsAction({ id: parcel.id, ...v })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`house-${parcel.id}`} label={t("houseNo")} error={fe("houseNo")}>
              <Input value={v.houseNo} maxLength={40} onChange={(e) => setV({ ...v, houseNo: e.target.value })} />
            </Field>
            <Field id={`receipt-${parcel.id}`} label={t("govtReceipt")} error={fe("govtReceiptNo")}>
              <Input value={v.govtReceiptNo} maxLength={60} onChange={(e) => setV({ ...v, govtReceiptNo: e.target.value })} />
            </Field>
            <Field id={`plot-${parcel.id}`} label={t("plotNo")} error={fe("plotNo")} className="sm:col-span-2">
              <Input value={v.plotNo} maxLength={40} onChange={(e) => setV({ ...v, plotNo: e.target.value })} />
            </Field>
          </div>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "register"}
        onOpenChange={close}
        title={t("fieldLand.registerTitle")}
        description={t("fieldLand.registerBody", { land: parcel.house_no ? `${t("houseNoShort")} ${parcel.house_no}` : name })}
        confirmLabel={t("fieldLand.register")}
        successMessage={t("fieldLand.registered")}
        submit={() => registerParcelAction({ parcelId: parcel.id })}
      />
      <FormDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={t("deleteTitle", { pun: name })}
        description={partial ? t("deleteBodyPartial") : t("deleteBodyRegistered")}
        confirmLabel={tc("delete")}
        destructive
        successMessage={t("deleted")}
        submit={() => deleteParcelAction({ id: parcel.id, reason })}
        onDone={() => onDetail && router.push("/parcels")}
      >
        {(fe) => (
          <Field id={`delete-${parcel.id}`} label={t("deleteReason")} error={fe("reason")} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "lock" || dialog === "unlock"}
        onOpenChange={close}
        title={dialog === "unlock" ? t("unlockTitle", { pun: name }) : t("lockTitle", { pun: name })}
        description={dialog === "unlock" ? t("unlockBody") : t("lockBody")}
        confirmLabel={dialog === "unlock" ? t("actionUnlock") : t("actionLock")}
        destructive={dialog === "lock"}
        successMessage={dialog === "unlock" ? t("unlocked") : t("locked")}
        submit={() => (dialog === "unlock" ? unlockParcelAction({ id: parcel.id, reason }) : lockParcelAction({ id: parcel.id, reason }))}
      >
        {(fe) => (
          <Field id={`reason-${parcel.id}`} label={t("lockReason")} hint={t("lockReasonHint")} error={fe("reason")} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}
