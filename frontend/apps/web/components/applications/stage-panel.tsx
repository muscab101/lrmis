"use client";

import type { AppError } from "@dhulka/core/errors";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { BadgeCheck, CalendarClock, Coins, Compass, Gavel, Landmark, MapPinned, MessageSquareWarning } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  assignSurveyAction,
  fileObjectionAction,
  registerParcelAction,
  resolveObjectionAction,
  surveyCandidatesAction,
  verifyApplicationAction,
  waiveFeeAction,
} from "@/app/[locale]/(staff)/surveys/actions";
import { FormError } from "@/components/forms/form-error";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { Link, useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { ApplicationStage } from "@/lib/server/applications";

export interface StagePermissions {
  waiveFee: boolean;
  assignSurvey: boolean;
  verify: boolean;
  register: boolean;
  resolveObjections: boolean;
  recordObjection: boolean;
}

interface Props {
  applicationId: string;
  status: ApplicationStatus;
  feeStatus: "due" | "paid" | "waived";
  feeNote: string | null;
  stage: ApplicationStage;
  can: StagePermissions;
  me: string;
  staff: boolean;
}

type DialogKind = "waive" | "assign" | "verify" | "register" | "object" | { resolve: string; status: "dismissed" | "upheld" } | null;

const LAND_USES = ["residential", "commercial", "mixed", "state", "agricultural", "other"] as const;

/** Where the application is in the survey → verification → notice → registration flow, and the next step for this user. */
export function StagePanel({ applicationId, status, feeStatus, feeNote, stage, can, me, staff }: Props) {
  const t = useTranslations("stage");
  const tc = useTranslations("common");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState({ documentsOk: false, surveyOk: false, identityOk: false });
  const [landUse, setLandUse] = useState<(typeof LAND_USES)[number]>("residential");
  const [candidates, setCandidates] = useState<{ user_id: string; full_name: string; open_tasks: number }[] | null>(null);
  const [surveyor, setSurveyor] = useState("");
  const [due, setDue] = useState("");
  const [objection, setObjection] = useState({ name: "", phone: "", statement: "" });

  const survey = stage.surveys.find((s) => s.status !== "cancelled") ?? null;
  const notice = stage.notice;
  const openObjections = notice?.objections.filter((o) => o.status === "open") ?? [];
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });

  function close() {
    setDialog(null);
    setError(null);
    setNote("");
  }

  async function run<T>(fn: () => Promise<{ ok: true; data?: T } | { ok: false; error: AppError }>, done: (data: T) => void) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    done(res.data as T);
    close();
    router.refresh();
  }

  async function openAssign() {
    setDialog("assign");
    setCandidates(null);
    const res = await surveyCandidatesAction({ applicationId });
    setCandidates(res.ok ? res.data : []);
  }

  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const formError = <FormError error={error && !error.fieldErrors ? error : null} />;

  // Nothing to show before submission or for closed-without-parcel applications.
  if (["draft", "cancelled"].includes(status) || (status === "rejected" && !stage.parcel)) return null;

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t(`hint.${status}`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[1fr_18rem]">
        <ol className="space-y-4">
          <Step icon={<Coins aria-hidden />} title={t("fee")} done={feeStatus !== "due"}>
            {feeStatus === "due" ? t("feeDue") : feeStatus === "waived" ? t("feeWaived", { note: feeNote ?? "" }) : t("feePaid")}
            {status === "awaiting_payment" && feeStatus === "due" && can.waiveFee && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setDialog("waive")}>
                {t("waive")}
              </Button>
            )}
          </Step>

          <Step icon={<Compass aria-hidden />} title={t("survey")} done={!!survey && ["submitted"].includes(survey.status) && status !== "in_survey"}>
            {survey ? (
              <span>
                {t(`surveyStatus.${survey.status}`)} · {survey.surveyor?.full_name ?? "—"}
                {survey.due_date && ` · ${t("dueOn", { date: date(survey.due_date) })}`}
                {survey.area_m2 != null && ` · ${format.number(Number(survey.area_m2), { maximumFractionDigits: 1 })} m²`}
              </span>
            ) : (
              t("noSurveyYet")
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {staff && survey && (survey.surveyor_id === me || can.assignSurvey) && (
                <Button size="sm" variant={survey.surveyor_id === me && status === "in_survey" ? "default" : "outline"} asChild>
                  <Link href={`/surveys/${survey.id}`}>
                    <MapPinned aria-hidden />
                    {survey.surveyor_id === me && status === "in_survey" ? t("openSurvey") : t("viewSurvey")}
                  </Link>
                </Button>
              )}
              {status === "in_survey" && can.assignSurvey && (
                <Button size="sm" variant="outline" onClick={() => void openAssign()}>
                  {survey ? t("reassign") : t("assign")}
                </Button>
              )}
            </div>
          </Step>

          <Step icon={<BadgeCheck aria-hidden />} title={t("verification")} done={["public_notice", "in_verification", "approved"].includes(status)}>
            {["public_notice", "in_verification", "approved"].includes(status) ? t("verified") : t("notVerified")}
            {status === "surveyed" && can.verify && (
              <Button size="sm" className="mt-2" onClick={() => setDialog("verify")}>
                {t("verify")}
              </Button>
            )}
          </Step>

          <Step icon={<CalendarClock aria-hidden />} title={t("notice")} done={!!notice && notice.status !== "open"}>
            {notice ? (
              <span>
                {notice.status === "open" ? t("noticeOpen", { date: date(notice.ends_at) }) : t("noticeClosed", { date: date(notice.ends_at) })} ·{" "}
                {t("objectionCount", { count: notice.objections.length })}
              </span>
            ) : (
              t("noNotice")
            )}
            {notice && notice.objections.length > 0 && (
              <ul className="mt-2 space-y-2">
                {notice.objections.map((o) => (
                  <li key={o.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {o.objector_name} {o.objector_phone && <Mono className="text-muted-foreground">{o.objector_phone}</Mono>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`objection.${o.status}`)} · {date(o.filed_at)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{o.statement}</p>
                    {o.resolution_note && <p className="mt-1 text-xs text-muted-foreground">{o.resolution_note}</p>}
                    {o.status === "open" && can.resolveObjections && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDialog({ resolve: o.id, status: "dismissed" })}>
                          {t("dismiss")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDialog({ resolve: o.id, status: "upheld" })}>
                          {t("uphold")}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {notice?.status === "open" && can.recordObjection && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setDialog("object")}>
                <MessageSquareWarning aria-hidden />
                {t("recordObjection")}
              </Button>
            )}
          </Step>

          <Step icon={<Landmark aria-hidden />} title={t("registration")} done={status === "approved"} last>
            {stage.parcel?.pun ? (
              <span>
                {t("registeredAs")} <Mono className="font-semibold">{stage.parcel.pun}</Mono> · {t("account")} <Mono>{stage.parcel.account_no}</Mono>
              </span>
            ) : (
              t("notRegistered")
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {status === "in_verification" && can.register && (
                <Button size="sm" disabled={openObjections.length > 0} onClick={() => setDialog("register")}>
                  <Gavel aria-hidden />
                  {t("register")}
                </Button>
              )}
              {staff && stage.parcel?.pun && status === "approved" && (
                // Last step: the title certificate, issued from the parcel's page.
                <Button size="sm" variant={stage.certificate ? "outline" : "default"} asChild>
                  <Link href={stage.certificate ? `/documents/${stage.certificate.id}` : `/parcels/${stage.parcel.id}#certificate`}>
                    <BadgeCheck aria-hidden />
                    {stage.certificate ? t("viewCertificate", { serial: stage.certificate.serial }) : t("nextCertificate")}
                  </Link>
                </Button>
              )}
              {staff && stage.parcel?.pun && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/parcels/${stage.parcel.id}`}>{t("openParcel")}</Link>
                </Button>
              )}
            </div>
            {status === "in_verification" && can.register && openObjections.length > 0 && (
              <p className="mt-1 text-xs text-status-rejected">{t("objectionsBlock")}</p>
            )}
          </Step>
        </ol>

        {stage.parcel?.geom ? (
          <div>
            <GeometryPreview geometry={stage.parcel.geom} />
            <p className="mt-2 text-xs text-muted-foreground">
              {stage.parcel.area_m2 != null && `${format.number(Number(stage.parcel.area_m2), { maximumFractionDigits: 1 })} m² · `}
              {t(`parcelStatus.${stage.parcel.status}`)}
            </p>
          </div>
        ) : (
          <div className="grid h-56 place-items-center rounded-md border border-dashed text-center text-sm text-muted-foreground">{t("noBoundary")}</div>
        )}
      </CardContent>

      {/* Fee waiver */}
      <ConfirmDialog
        open={dialog === "waive"}
        onOpenChange={(o) => !o && close()}
        title={t("waiveTitle")}
        description={t("waiveBody")}
        confirmLabel={t("waive")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() => void run(() => waiveFeeAction({ applicationId, note }), () => toast.success(t("waived")))}
      >
        {formError}
        <Field id="waive-note" label={t("reason")} error={fe("note")} required>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Survey assignment */}
      <ConfirmDialog
        open={dialog === "assign"}
        onOpenChange={(o) => !o && close()}
        title={t("assignTitle")}
        description={t("assignBody")}
        confirmLabel={t("assign")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() =>
          void run(
            () => assignSurveyAction({ applicationId, surveyorId: surveyor || null, dueDate: due || null }),
            () => toast.success(t("assigned")),
          )
        }
      >
        {formError}
        <Field id="surveyor" label={t("surveyor")} hint={candidates?.length === 0 ? t("noCandidates") : undefined}>
          <NativeSelect value={surveyor} onChange={(e) => setSurveyor(e.target.value)} disabled={!candidates}>
            <option value="">{t("autoAssign")}</option>
            {candidates?.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.full_name} ({t("openTasks", { count: Number(c.open_tasks) })})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="due" label={t("dueDate")}>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Land officer verification */}
      <ConfirmDialog
        open={dialog === "verify"}
        onOpenChange={(o) => !o && close()}
        title={t("verifyTitle")}
        description={t("verifyBody")}
        confirmLabel={t("verify")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() =>
          void run(
            () => verifyApplicationAction({ applicationId, ...checks, note }),
            (d: { status: string; notice_days: number }) => toast.success(d.status === "public_notice" ? t("noticeStarted", { days: d.notice_days }) : t("verifiedDone")),
          )
        }
      >
        {formError}
        <div className="space-y-2">
          {(["documentsOk", "surveyOk", "identityOk"] as const).map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <Checkbox checked={checks[k]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [k]: v === true }))} className="mt-0.5" />
              {t(`checks.${k}`)}
            </label>
          ))}
        </div>
        <Field id="verify-note" label={t("noteOptional")}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Registrar */}
      <ConfirmDialog
        open={dialog === "register"}
        onOpenChange={(o) => !o && close()}
        title={t("registerTitle")}
        description={t("registerBody")}
        confirmLabel={t("register")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() =>
          void run(
            () => registerParcelAction({ applicationId, landUse, note }),
            (d: { pun: string }) => toast.success(t("registeredDone", { pun: d.pun })),
          )
        }
      >
        {formError}
        <Field id="land-use" label={t("landUse")} required>
          <NativeSelect value={landUse} onChange={(e) => setLandUse(e.target.value as typeof landUse)}>
            {LAND_USES.map((u) => (
              <option key={u} value={u}>
                {t(`landUses.${u}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="register-note" label={t("noteOptional")}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      {/* Objection recorded by staff (received in person) */}
      <ConfirmDialog
        open={dialog === "object"}
        onOpenChange={(o) => !o && close()}
        title={t("recordObjection")}
        description={t("recordObjectionBody")}
        confirmLabel={t("recordObjection")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() =>
          void run(
            () => fileObjectionAction({ noticeId: notice!.id, ...objection }),
            () => {
              toast.success(t("objectionRecorded"));
              setObjection({ name: "", phone: "", statement: "" });
            },
          )
        }
      >
        {formError}
        <Field id="obj-name" label={t("objectorName")} error={fe("name")} required>
          <Input value={objection.name} onChange={(e) => setObjection((o) => ({ ...o, name: e.target.value }))} />
        </Field>
        <Field id="obj-phone" label={t("objectorPhone")} error={fe("phone")}>
          <Input inputMode="tel" placeholder="+252…" value={objection.phone} onChange={(e) => setObjection((o) => ({ ...o, phone: e.target.value }))} />
        </Field>
        <Field id="obj-statement" label={t("statement")} error={fe("statement")} required>
          <Textarea rows={4} value={objection.statement} onChange={(e) => setObjection((o) => ({ ...o, statement: e.target.value }))} />
        </Field>
      </ConfirmDialog>

      {/* Objection decision */}
      <ConfirmDialog
        open={typeof dialog === "object" && dialog !== null}
        onOpenChange={(o) => !o && close()}
        title={typeof dialog === "object" && dialog ? t(dialog.status === "upheld" ? "upholdTitle" : "dismissTitle") : ""}
        description={typeof dialog === "object" && dialog ? t(dialog.status === "upheld" ? "upholdBody" : "dismissBody") : ""}
        confirmLabel={typeof dialog === "object" && dialog ? t(dialog.status === "upheld" ? "uphold" : "dismiss") : ""}
        cancelLabel={tc("cancel")}
        destructive={typeof dialog === "object" && dialog?.status === "upheld"}
        loading={busy}
        onConfirm={() => {
          if (typeof dialog !== "object" || !dialog) return;
          void run(() => resolveObjectionAction({ objectionId: dialog.resolve, status: dialog.status, note }), () => toast.success(t("objectionDecided")));
        }}
      >
        {formError}
        <Field id="resolve-note" label={t("reason")} error={fe("note")} required>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

function Step({ icon, title, done, last = false, children }: { icon: React.ReactNode; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3">
      {!last && <span aria-hidden className="absolute start-4 top-9 bottom-[-1rem] w-px bg-border" />}
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full border [&_svg]:size-4 ${done ? "border-status-approved/40 bg-status-approved/10 text-status-approved" : "bg-card text-muted-foreground"}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
