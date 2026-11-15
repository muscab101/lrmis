"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Check, Home, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AppError } from "@dhulka/core/errors";
import { toast } from "@dhulka/ui/toaster";
import { useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useValidationMessage } from "@/lib/client/errors";
import {
  demolitionDecideAction,
  demolitionReregisterAction,
  demolitionRestoreAction,
  demolitionRestoreManyAction,
} from "@/app/[locale]/(staff)/demolished/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

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

/** Marked by mistake, many at once (for example a whole neighbourhood): put every one back. */
export function UndoAllDemolitions({ ids }: { ids: string[] }) {
  const t = useTranslations("demolitions");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        {t("undoAll", { count: ids.length })}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("undoAllTitle", { count: ids.length })}
        description={t("undoAllBody")}
        confirmLabel={t("undoAll", { count: ids.length })}
        successMessage={t("doneUndoAll")}
        submit={() => demolitionRestoreManyAction({ ids, reason })}
        onDone={() => setReason("")}
      >
        {(fe) => (
          <Field id="undoAllReason" label={t("restoreReason")} error={fe("reason")} required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

/** A new house on the land, on its own page: the same PUN, a new building number, the same owner or a new one. */
export function RegisterAgainForm({
  id,
  houseNo,
  owners,
  grades,
  cancelHref,
}: {
  id: string;
  houseNo: string | null;
  owners: string;
  grades: { code: string; name: string }[];
  cancelHref: string;
}) {
  const t = useTranslations("demolitions");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const fe = (name: string) => vm(error?.fieldErrors?.[name]?.[0]);
  const [v, setV] = useState({
    who: "same" as "same" | "new",
    name: "",
    phone: "",
    grade: "",
    house: houseNo ?? "",
    note: "",
  });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await demolitionReregisterAction({
          id,
          keepOwner: v.who === "same",
          ownerName: v.name,
          ownerPhone: v.phone,
          propertyType: v.grade,
          houseNo: v.house,
          note: v.note,
        });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(t("doneRegistered"));
        // The land is registered again: open it.
        router.push(`/parcels/${res.data.parcel_id}`);
      }}
    >
      <FormError error={error && !error.fieldErrors ? error : null} />
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="againName" label={t("ownerName")} error={fe("ownerName")} required>
            <Input allow="letters" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} />
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="againGrade" label={t("newGrade")} error={fe("propertyType")} required>
          <NativeSelect value={v.grade} onChange={(e) => setV((s) => ({ ...s, grade: e.target.value }))}>
            <option value="">{t("choose")}</option>
            {grades.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="againHouse" label={t("newHouseNo")} hint={t("newHouseNoHint")} error={fe("houseNo")}>
          <Input value={v.house} onChange={(e) => setV((s) => ({ ...s, house: e.target.value }))} />
        </Field>
      </div>
      <Field id="againNote" label={t("noteOptional")} error={fe("note")}>
        <Textarea rows={3} value={v.note} onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))} />
      </Field>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          <Home aria-hidden />
          {t("registerNow")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref)} disabled={busy}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
