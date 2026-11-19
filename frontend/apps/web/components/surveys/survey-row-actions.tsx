"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { ClipboardCheck, MapPinned, Send, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { reassignSurveyAction, submitSurveyAction, surveyCandidatesAction } from "@/app/[locale]/(staff)/surveys/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";

const OPEN = ["assigned", "in_progress", "returned"];

/**
 * A survey's row actions: Open; Submit for checks (its surveyor); Review (a submitted one, for supervisors); and give it
 * to another surveyor (supervisors). Each shows only when it can be done.
 */
export function SurveyRowActions({
  survey,
  me,
  can,
}: {
  survey: { id: string; status: string; surveyor_id: string; application_id: string | null };
  me: string;
  can: { update: boolean; approve: boolean };
}) {
  const t = useTranslations("surveys");
  const [dialog, setDialog] = useState<null | "submit" | "reassign">(null);
  const [people, setPeople] = useState<{ user_id: string; full_name: string; open_tasks: number }[] | null>(null);
  const [to, setTo] = useState("");
  const [due, setDue] = useState("");
  const open = OPEN.includes(survey.status);
  const canSubmit = open && survey.surveyor_id === me && can.update;
  const canReview = (survey.status === "submitted" || survey.status === "overlap_review") && can.approve;
  const canReassign = open && can.approve && !!survey.application_id;

  const startReassign = async () => {
    setDialog("reassign");
    setPeople(null);
    const res = await surveyCandidatesAction({ applicationId: survey.application_id! });
    if (!res.ok) {
      setDialog(null);
      return void toast.error(t("reassignFailed"));
    }
    setPeople(res.data.filter((p) => p.user_id !== survey.surveyor_id));
    setTo("");
  };

  const tip = (label: string, node: React.ReactElement) => <Tooltip content={label}>{node}</Tooltip>;
  return (
    <div className="flex justify-end gap-0.5">
      {tip(
        t("actionOpen"),
        <Button asChild variant="ghost" size="icon-sm" className="text-primary">
          <Link href={`/surveys/${survey.id}`} aria-label={t("actionOpen")}>
            <MapPinned aria-hidden />
          </Link>
        </Button>,
      )}
      {canReview &&
        tip(
          t("actionReview"),
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={`/surveys/${survey.id}`} aria-label={t("actionReview")}>
              <ClipboardCheck aria-hidden />
            </Link>
          </Button>,
        )}
      {canSubmit &&
        tip(
          t("submit"),
          <Button variant="ghost" size="icon-sm" aria-label={t("submit")} onClick={() => setDialog("submit")}>
            <Send aria-hidden />
          </Button>,
        )}
      {canReassign &&
        tip(
          t("actionReassign"),
          <Button variant="ghost" size="icon-sm" aria-label={t("actionReassign")} onClick={() => void startReassign()}>
            <UserCog aria-hidden />
          </Button>,
        )}

      <FormDialog
        open={dialog === "submit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("submitTitle")}
        description={t("submitRowBody")}
        confirmLabel={t("submit")}
        submit={() => submitSurveyAction({ surveyId: survey.id })}
        onDone={(d) => {
          const r = d as { overlaps: unknown[] } | undefined;
          toast.success(r && r.overlaps?.length ? t("submittedWithOverlaps") : t("submittedOk"));
          setDialog(null);
        }}
      />
      <FormDialog
        open={dialog === "reassign"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("reassignTitle")}
        description={t("reassignBody")}
        confirmLabel={t("actionReassign")}
        submit={() => reassignSurveyAction({ applicationId: survey.application_id!, surveyorId: to, due })}
        onDone={() => {
          toast.success(t("reassigned"));
          setDialog(null);
        }}
      >
        {(fe) =>
          people === null ? (
            <p className="text-muted-foreground text-sm">…</p>
          ) : people.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noOtherSurveyor")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`to-${survey.id}`} label={t("surveyor")} error={fe("surveyorId")} required>
                <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">{t("chooseSurveyor")}</option>
                  {people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {t("surveyorWithTasks", { name: p.full_name, count: Number(p.open_tasks) })}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={`due-${survey.id}`} label={t("due")}>
                <Input type="date" value={due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>
          )
        }
      </FormDialog>
    </div>
  );
}
