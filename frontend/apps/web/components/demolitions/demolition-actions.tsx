"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Check, Home, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  demolitionDecideAction,
  demolitionReregisterAction,
  demolitionRestoreAction,
} from "@/app/[locale]/(staff)/demolished/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Approve or reject requests, one or several together. */
export function DecideDemolition({ ids, size = "sm" }: { ids: string[]; size?: "sm" | "default" }) {
  const t = useTranslations("demolitions");
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const approve = dialog === "approve";
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size={size} onClick={() => setDialog("approve")}>
        <Check aria-hidden />
        {t("approve")}
      </Button>
      <Button type="button" size={size} variant="outline" onClick={() => setDialog("reject")}>
        <X aria-hidden />
        {t("reject")}
      </Button>
      <FormDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          approve
            ? t("approveTitle", { count: ids.length })
            : t("rejectTitle", { count: ids.length })
        }
        description={approve ? t("approveBody") : t("rejectBody")}
        confirmLabel={approve ? t("approve") : t("reject")}
        destructive={approve}
        successMessage={approve ? t("doneApproved") : t("doneRejected")}
        submit={() => demolitionDecideAction({ ids, approve, note })}
        onDone={() => setNote("")}
      >
        {(fe) => (
          <Field
            id="decisionNote"
            label={approve ? t("noteOptional") : t("rejectReason")}
            error={fe("note")}
            required={!approve}
          >
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}

/** Marked by mistake: put the land back as it was. */
export function RestoreDemolition({ id }: { id: string }) {
  const t = useTranslations("demolitions");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        {t("restore")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("restoreTitle")}
        description={t("restoreBody")}
        confirmLabel={t("restore")}
        successMessage={t("doneRestored")}
        submit={() => demolitionRestoreAction({ id, reason })}
      >
        {(fe) => (
          <Field id="restoreReason" label={t("restoreReason")} error={fe("reason")} required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

/** A new house on the land: the same PUN, a new building number, the same owner or a new one. */
export function RegisterAgain({
  id,
  houseNo,
  owners,
  grades,
}: {
  id: string;
  houseNo: string | null;
  owners: string;
  grades: { code: string; name: string }[];
}) {
  const t = useTranslations("demolitions");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    who: "same" as "same" | "new",
    name: "",
    phone: "",
    grade: "",
    house: houseNo ?? "",
    note: "",
  });
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Home aria-hidden />
        {t("registerAgain")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("registerAgainTitle")}
        description={t("registerAgainBody")}
        confirmLabel={t("registerAgain")}
        successMessage={t("doneRegistered")}
        submit={() =>
          demolitionReregisterAction({
            id,
            keepOwner: v.who === "same",
            ownerName: v.name,
            ownerPhone: v.phone,
            propertyType: v.grade,
            houseNo: v.house,
            note: v.note,
          })
        }
      >
        {(fe) => (
          <div className="space-y-3">
            <Field id="againWho" label={t("owner")} required>
              <NativeSelect
                value={v.who}
                onChange={(e) => setV((s) => ({ ...s, who: e.target.value as "same" | "new" }))}
              >
                <option value="same">{t("sameOwner", { names: owners || "—" })}</option>
                <option value="new">{t("newOwner")}</option>
              </NativeSelect>
            </Field>
            {v.who === "new" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="againName" label={t("ownerName")} error={fe("ownerName")} required>
                  <Input
                    value={v.name}
                    onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
                  />
                </Field>
                <Field id="againPhone" label={t("ownerPhone")} error={fe("ownerPhone")}>
                  <Input
                    type="tel"
                    value={v.phone}
                    placeholder="+252…"
                    onChange={(e) => setV((s) => ({ ...s, phone: e.target.value }))}
                  />
                </Field>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="againGrade" label={t("newGrade")} error={fe("propertyType")} required>
                <NativeSelect
                  value={v.grade}
                  onChange={(e) => setV((s) => ({ ...s, grade: e.target.value }))}
                >
                  <option value="">{t("choose")}</option>
                  {grades.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="againHouse"
                label={t("newHouseNo")}
                hint={t("newHouseNoHint")}
                error={fe("houseNo")}
              >
                <Input
                  value={v.house}
                  onChange={(e) => setV((s) => ({ ...s, house: e.target.value }))}
                />
              </Field>
            </div>
            <Field id="againNote" label={t("noteOptional")} error={fe("note")}>
              <Textarea
                rows={2}
                value={v.note}
                onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}
