"use client";

import { Button } from "@dhulka/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { LAND_USES } from "@dhulka/core/schemas";
import { Input, Textarea } from "@dhulka/ui/input";
import { BadgeCheck, Ellipsis, Info, Lock, LockOpen, MapPin, Pencil, Trash2, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type BillCheck, deleteParcelAction, lockParcelAction, parcelBillCheckAction, parcelEditInfoAction, registerParcelAction, unlockParcelAction, updateParcelDetailsAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { OwnerFields } from "@/components/owners/owner-fields";
import { HouseNoSelect } from "@/components/parcels/house-no-select";
import { PartialRebillDialog } from "@/components/parcels/partial-rebill";
import { Link, useRouter } from "@/i18n/navigation";
import { isApartmentType } from "@/lib/apartment";

/** The size and type of land being edited, as one value to compare. */
const sizeKey = (i: { propertyType: string | null; widthM: string; lengthM: string; unit?: { ownM2: string } | null }) =>
  [i.propertyType, i.widthM, i.lengthM, i.unit?.ownM2 ?? ""].join("|");

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
  const ta = useTranslations("applications");
  const locale = useLocale();
  // The property type and unit are loaded when the edit opens (the tables don't carry them).
  type Info = Extract<Awaited<ReturnType<typeof parcelEditInfoAction>>, { ok: true }>["data"];
  const [info, setInfo] = useState<Info | null>(null);
  const ts = useTranslations("stage");
  const tf = useTranslations("parcels.fieldLand");
  const tu = useTranslations("parcels.landUnits");
  // The size and type when the edit opened: a change to them shows Re-bill and Approve after saving.
  const [sizeBefore, setSizeBefore] = useState("");
  const [bill, setBill] = useState<NonNullable<BillCheck> | null>(null);
  useEffect(() => {
    if (dialog !== "edit") return;
    setInfo(null);
    void parcelEditInfoAction({ id: parcel.id }).then((r) => {
      if (!r.ok) return;
      setInfo(r.data);
      setSizeBefore(sizeKey(r.data));
    });
  }, [dialog, parcel.id]);
  const apartment = !!info && isApartmentType(info.propertyType, info.types);
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
        className={partial ? "sm:max-w-2xl" : undefined}
        description={partial ? t("editBody") : t("editBodyRegistered")}
        confirmLabel={tc("saveChanges")}
        successMessage={tc("saved")}
        onDone={() => {
          // Partial land with a new size or type: show its bill now and the new one, with Re-bill and Approve.
          if (!partial || !info || sizeKey(info) === sizeBefore) return;
          void parcelBillCheckAction({ id: parcel.id }).then((r) => r.ok && r.data && setBill(r.data));
        }}
        submit={() =>
          updateParcelDetailsAction({
            id: parcel.id,
            ...v,
            ...(info
              ? {
                  ...(partial ? { propertyType: info.propertyType } : {}),
                  ...(info.unit ? {} : { flatNo: apartment ? info.flatNo : "" }),
                  landUse: info.landUse,
                  ...(info.unit
                    ? info.unit.partial
                      ? { ownM2: info.unit.ownM2, ...(info.unit.flats ? { unitFloor: info.unit.floor } : {}) }
                      : {}
                    : partial
                      ? { widthM: info.widthM, lengthM: info.lengthM }
                      : {}),
                  // With full owner details, the name and phone come from them (saved together with the land).
                  ...(info.ownerDetails
                    ? {
                        ownerName: info.ownerDetails.input.fullName ?? "",
                        ownerPhone: info.ownerDetails.input.phone ?? "",
                        ownerId: info.ownerDetails.id,
                        owner: info.ownerDetails.input,
                      }
                    : info.owner
                      ? { ownerName: info.owner.name, ownerPhone: info.owner.phone }
                      : {}),
                }
              : {}),
          })
        }
      >
        {(fe) => (
          <div className="space-y-4">
            {/* The land: where it is, what it is and how big. */}
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
                <MapPin className="size-4" aria-hidden />
                {t("editLand")}
              </legend>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <Field id={`house-${parcel.id}`} label={t("houseNo")} error={fe("houseNo")}>
                  <HouseNoSelect source={{ parcelId: parcel.id }} value={v.houseNo} onChange={(houseNo) => setV({ ...v, houseNo })} />
                </Field>
                <Field id={`plot-${parcel.id}`} label={t("plotNo")} error={fe("plotNo")}>
                  <Input value={v.plotNo} maxLength={40} onChange={(e) => setV({ ...v, plotNo: e.target.value })} />
                </Field>
                {/* Registered land keeps the size and type its bills and certificate were made from. */}
                {partial && (
                  <Field id={`type-${parcel.id}`} label={ta("propertyType")} error={fe("propertyType")}>
                    <NativeSelect value={info?.propertyType ?? ""} disabled={!info} onChange={(e) => info && setInfo({ ...info, propertyType: e.target.value })}>
                      <option value="">{ta("choose")}</option>
                      {(info?.types ?? [])
                        .filter((p) => p.active || p.code === info?.propertyType)
                        .map((p) => (
                          <option key={p.code} value={p.code}>
                            {locale === "so" ? p.name_so : p.name_en}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                )}
                <Field id={`use-${parcel.id}`} label={ts("landUse")}>
                  <NativeSelect value={info?.landUse ?? "residential"} disabled={!info} onChange={(e) => info && setInfo({ ...info, landUse: e.target.value as Info["landUse"] })}>
                    {LAND_USES.map((u) => (
                      <option key={u} value={u}>
                        {ts(`landUses.${u}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {apartment && !info?.unit && (
                  <Field id={`flat-${parcel.id}`} label={ta("flatNo")} hint={ta("flatNoHint")} error={fe("flatNo")} className="sm:col-span-2">
                    <Input value={info!.flatNo} maxLength={20} onChange={(e) => setInfo({ ...info!, flatNo: e.target.value })} />
                  </Field>
                )}
                {info?.unit
                  ? info.unit.partial && (
                      <>
                        <Field id={`own-${parcel.id}`} label={tu("ownM2")} hint={t("rebillHint")} error={fe("ownM2")}>
                          <Input type="number" inputMode="decimal" min={0} step="0.01" value={info.unit.ownM2} onChange={(e) => setInfo({ ...info, unit: { ...info.unit!, ownM2: e.target.value } })} />
                        </Field>
                        {info.unit.flats && (
                          <Field id={`floor-${parcel.id}`} label={tu("floor")} error={fe("unitFloor")}>
                            <Input type="number" inputMode="numeric" min={0} max={info.unit.floors ?? undefined} value={info.unit.floor} onChange={(e) => setInfo({ ...info, unit: { ...info.unit!, floor: e.target.value } })} />
                          </Field>
                        )}
                      </>
                    )
                  : partial && (
                      <>
                        <Field id={`w-${parcel.id}`} label={ta("plotWidth")} error={fe("widthM")}>
                          <Input type="number" inputMode="decimal" min={0} step="0.1" value={info?.widthM ?? ""} disabled={!info} onChange={(e) => info && setInfo({ ...info, widthM: e.target.value })} />
                        </Field>
                        <Field id={`l-${parcel.id}`} label={ta("plotLength")}>
                          <Input type="number" inputMode="decimal" min={0} step="0.1" value={info?.lengthM ?? ""} disabled={!info} onChange={(e) => info && setInfo({ ...info, lengthM: e.target.value })} />
                        </Field>
                        {/* The size worked out as it is typed: the bill is made from it. */}
                        {info && Number(info.widthM) > 0 && Number(info.lengthM) > 0 && (
                          <p className="bg-muted/50 rounded-md px-3 py-2 text-sm sm:col-span-2">
                            <span className="text-muted-foreground">{tf("area")}: </span>
                            <span className="font-medium tabular-nums">{Math.round(Number(info.widthM) * Number(info.lengthM) * 10) / 10} m²</span>
                            <span className="text-muted-foreground ms-2 text-xs">{t("rebillHint")}</span>
                          </p>
                        )}
                      </>
                    )}
              </div>
            </fieldset>

            {/* The owner, saved in the same go. */}
            {info?.ownerDetails ? (
              <OwnerFields value={info.ownerDetails.input} onChange={(input) => setInfo({ ...info, ownerDetails: { ...info.ownerDetails!, input } })} error={fe} />
            ) : (
              info?.owner && (
                <fieldset className="space-y-3 rounded-md border p-3">
                  <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
                    <UserRound className="size-4" aria-hidden />
                    {tf("ownerName")}
                  </legend>
                  <div className="grid items-start gap-3 sm:grid-cols-2">
                    <Field id={`owner-${parcel.id}`} label={tf("ownerName")} error={fe("ownerName")}>
                      <Input value={info.owner.name} maxLength={120} onChange={(e) => setInfo({ ...info, owner: { ...info.owner!, name: e.target.value } })} />
                    </Field>
                    <Field id={`phone-${parcel.id}`} label={tf("ownerPhone")}>
                      <Input type="tel" value={info.owner.phone} maxLength={30} onChange={(e) => setInfo({ ...info, owner: { ...info.owner!, phone: e.target.value } })} />
                    </Field>
                  </div>
                </fieldset>
              )
            )}
          </div>
        )}
      </FormDialog>
      {bill && (
        <PartialRebillDialog
          open
          onOpenChange={(o) => !o && setBill(null)}
          parcelId={parcel.id}
          land={parcel.house_no ? `${t("houseNoShort")} ${parcel.house_no}` : name}
          check={bill}
          can={{ rebill: can.update, approve: canRegister }}
        />
      )}
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
