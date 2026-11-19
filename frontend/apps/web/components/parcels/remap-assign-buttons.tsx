"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Textarea } from "@dhulka/ui/input";
import { MapPin, MapPinned, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { assignRemapAction, cancelRemapAction, remapCandidatesAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";

type Surveyor = { user_id: string; full_name: string; open_remaps: number };

/**
 * Remapping on the land's page: staff who look after land give it to a surveyor (or change or call it off);
 * the surveyor it was given to opens the remap screen from here.
 */
export function RemapAssignButtons({
  parcelId,
  canAssign,
  assignedTo,
  canRemap,
  size = "sm",
}: {
  parcelId: string;
  canAssign: boolean;
  /** The surveyor the open remapping is with, if any. */
  assignedTo: string | null;
  /** The viewer is that surveyor (and captures locations). */
  canRemap: boolean;
  size?: "sm" | "default";
}) {
  const t = useTranslations("parcels.remapJob");
  const [open, setOpen] = useState<"assign" | "cancel" | null>(null);
  const [surveyors, setSurveyors] = useState<Surveyor[] | null>(null);
  const [surveyor, setSurveyor] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open !== "assign" || surveyors) return;
    void remapCandidatesAction({ id: parcelId }).then((r) => {
      const list = r.ok ? r.data : [];
      setSurveyors(list);
      setSurveyor((cur) => cur || (list.find((s) => s.user_id !== assignedTo)?.user_id ?? ""));
    });
  }, [open, surveyors, parcelId, assignedTo]);

  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      setNote("");
    }
  };

  return (
    <>
      {canRemap && (
        <Button size={size} asChild>
          <Link href={`/parcels/${parcelId}/remap`}>
            <MapPin aria-hidden />
            {t("remapNow")}
          </Link>
        </Button>
      )}
      {canAssign && (
        <Button size={size} variant="outline" onClick={() => setOpen("assign")}>
          <MapPinned aria-hidden />
          {assignedTo ? t("reassign") : t("assign")}
        </Button>
      )}
      {canAssign && assignedTo && (
        <Button size={size} variant="ghost" onClick={() => setOpen("cancel")}>
          <XCircle aria-hidden />
          {t("cancel")}
        </Button>
      )}
      <FormDialog
        open={open === "assign"}
        onOpenChange={close}
        title={t("assignTitle")}
        description={t("assignBody")}
        confirmLabel={t("assign")}
        successMessage={t("assigned")}
        submit={() => assignRemapAction({ id: parcelId, surveyorId: surveyor, note })}
      >
        {(fe) => (
          <>
            <Field
              id="surveyorId"
              label={t("surveyor")}
              error={fe("surveyorId")}
              hint={surveyors && surveyors.length === 0 ? t("noSurveyors") : undefined}
              required
            >
              <NativeSelect value={surveyor} disabled={!surveyors?.length} onChange={(e) => setSurveyor(e.target.value)}>
                <option value="">{surveyors ? t("choose") : t("loading")}</option>
                {(surveyors ?? []).map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.full_name} · {t("openJobs", { count: s.open_remaps })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="note" label={t("note")} error={fe("note")}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />
            </Field>
          </>
        )}
      </FormDialog>
      <FormDialog
        open={open === "cancel"}
        onOpenChange={close}
        title={t("cancelTitle")}
        description={t("cancelBody")}
        confirmLabel={t("cancel")}
        destructive
        successMessage={t("cancelled")}
        submit={() => cancelRemapAction({ id: parcelId })}
      />
    </>
  );
}
