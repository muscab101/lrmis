"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  assessParcelAction,
  fileAppealAction,
  previewAssessmentAction,
  removeBuildingAction,
  requestExemptionAction,
  saveBuildingAction,
} from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { Breakdown, Grade, ParcelValuation as Data } from "@/lib/server/valuation";

interface Props {
  parcelId: string;
  registered: boolean;
  data: Data;
  grades: Grade[];
  can: { edit: boolean; assess: boolean };
}

const KINDS = ["mosque", "school", "hospital", "government", "hardship", "other"] as const;

export function ParcelValuation({ parcelId, registered, data, grades, can }: Props) {
  const t = useTranslations("valuation");
  const format = useFormatter();
  const locale = useLocale();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [building, setBuilding] = useState<null | { id: string | null; gradeId: string; units: string; floors: string; areaM2: string; use: string; note: string }>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [assessOpen, setAssessOpen] = useState(false);
  const [exemption, setExemption] = useState<null | { kind: (typeof KINDS)[number]; pct: string; reason: string; validFrom: string; validTo: string }>(null);
  const [appeal, setAppeal] = useState<null | { assessmentId: string; reason: string; requested: string }>(null);

  const live = data.assessments.filter((a) => a.status === "issued");
  const openAppealIds = new Set(data.appeals.filter((a) => a.status === "open").map((a) => a.assessment?.id));
  const activeGrades = grades.filter((g) => g.active);
  const gname = (g: { name_so: string; name_en: string } | null) => (g ? (locale === "so" ? g.name_so : g.name_en) : "—");

  // Live preview of the tax for the chosen year (refreshes after any change on the page).
  const fingerprint = JSON.stringify([data.buildings.map((b) => [b.id, b.units, b.grade?.id]), data.exemptions.map((e) => e.status), year]);
  useEffect(() => {
    if (!registered) return;
    void previewAssessmentAction({ parcelId, year }).then((r) => setPreview(r.ok ? (r.data as Breakdown) : null));
  }, [parcelId, year, registered, fingerprint]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("parcelTitle")}</CardTitle>
          <CardDescription>{t("parcelHelp")}</CardDescription>
        </div>
        {registered && (
          <NativeSelect value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label={t("year")}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {!registered && <Alert tone="info" title={t("notRegisteredYet")} />}

        {/* Buildings */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="label-caps text-muted-foreground">{t("buildings")}</h3>
            {can.edit && (
              <Button size="sm" variant="outline" onClick={() => setBuilding({ id: null, gradeId: activeGrades[0]?.id ?? "", units: "1", floors: "1", areaM2: "", use: "", note: "" })}>
                <Plus aria-hidden />
                {t("addBuilding")}
              </Button>
            )}
          </div>
          {data.buildings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noBuildings")}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {data.buildings.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium">{gname(b.grade)}</span>
                    <span className="ms-2 text-muted-foreground">
                      {t("unitsFloors", { units: b.units, floors: b.floors })}
                      {b.area_m2 != null && ` · ${format.number(Number(b.area_m2))} m²`}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="me-2 tabular-nums">{b.grade ? usd(Number(b.grade.amount) * b.units) : ""}</span>
                    {can.edit && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("edit")}
                          onClick={() =>
                            setBuilding({ id: b.id, gradeId: b.grade?.id ?? "", units: String(b.units), floors: String(b.floors), areaM2: b.area_m2 != null ? String(b.area_m2) : "", use: b.use ?? "", note: b.note ?? "" })
                          }
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={t("remove")} onClick={() => setRemoving(b.id)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Calculation */}
        {registered && preview && (
          <section>
            <h3 className="label-caps mb-2 text-muted-foreground">{t("calculation", { year })}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 rounded-md border p-3 text-sm">
              <dt>
                {t("landLine", { area: format.number(Number(preview.area_m2)), rate: format.number(Number(preview.rate_m2), { maximumFractionDigits: 4 }) })}
                <span className="block text-xs text-muted-foreground">
                  {preview.rate_source === "default" ? t("defaultRate") : t("rateFrom", { date: preview.rate_valid_from ?? "" })}
                </span>
              </dt>
              <dd className="tabular-nums">{usd(preview.land_amount)}</dd>
              <dt>{t("buildingsLine")}</dt>
              <dd className="tabular-nums">{usd(preview.buildings_amount)}</dd>
              {Number(preview.exemption_pct) > 0 && (
                <>
                  <dt>{t("exemptionLine", { pct: Number(preview.exemption_pct), kind: t(`exemptionKinds.${preview.exemption_kind}`) })}</dt>
                  <dd className="tabular-nums text-status-approved">−{usd(preview.exemption_amount)}</dd>
                </>
              )}
              <dt>{t("serviceCharge")}</dt>
              <dd className="tabular-nums">{usd(preview.service_charge)}</dd>
              <dt className="border-t pt-1.5 font-semibold">{t("annualTax")}</dt>
              <dd className="border-t pt-1.5 font-semibold tabular-nums">{usd(preview.total)}</dd>
            </dl>
            {can.assess && (
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={() => setAssessOpen(true)}>
                  <Calculator aria-hidden />
                  {t("issueAssessment", { year })}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Assessments */}
        {data.assessments.length > 0 && (
          <section>
            <h3 className="label-caps mb-2 text-muted-foreground">{t("assessments")}</h3>
            <ul className="divide-y rounded-md border text-sm">
              {data.assessments.map((a) => (
                <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${a.status === "superseded" ? "text-muted-foreground" : ""}`}>
                  <span>
                    <Mono>{a.number}</Mono> · {a.year}
                    {a.override_note && <span className="block text-xs">{a.override_note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{usd(a.total)}</span>
                    <span className="text-xs">{t(`assessmentStatus.${a.status}`)}</span>
                    {a.status === "issued" && can.assess && !openAppealIds.has(a.id) && (
                      <Button size="sm" variant="ghost" onClick={() => setAppeal({ assessmentId: a.id, reason: "", requested: "" })}>
                        {t("recordAppeal")}
                      </Button>
                    )}
                    {openAppealIds.has(a.id) && <span className="rounded-sm bg-status-pending/10 px-1.5 text-[11px] text-status-pending">{t("appealStatus.open")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Exemptions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="label-caps text-muted-foreground">{t("exemptions")}</h3>
            {can.assess && registered && (
              <Button size="sm" variant="outline" onClick={() => setExemption({ kind: "hardship", pct: "50", reason: "", validFrom: `${thisYear}-01-01`, validTo: "" })}>
                <Plus aria-hidden />
                {t("requestExemption")}
              </Button>
            )}
          </div>
          {data.exemptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noExemptionsParcel")}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {data.exemptions.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {t(`exemptionKinds.${e.kind}`)} · {Number(e.pct)}%<span className="block text-xs text-muted-foreground">{e.reason}</span>
                  </span>
                  <span className="text-xs">{t(`decision.${e.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {live.length === 0 && registered && <p className="text-xs text-muted-foreground">{t("noLiveAssessment")}</p>}
      </CardContent>

      <FormDialog
        open={building !== null}
        onOpenChange={(o) => !o && setBuilding(null)}
        title={building?.id ? t("editBuilding") : t("addBuilding")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() =>
          saveBuildingAction({
            id: building!.id,
            parcelId,
            gradeId: building!.gradeId,
            units: building!.units,
            floors: building!.floors,
            areaM2: building!.areaM2 === "" ? null : building!.areaM2,
            use: building!.use,
            note: building!.note,
          })
        }
      >
        {(fe) =>
          building && (
            <>
              <Field id="grade" label={t("grade")} error={fe("gradeId")} required>
                <NativeSelect value={building.gradeId} onChange={(e) => setBuilding({ ...building, gradeId: e.target.value })}>
                  {activeGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {gname(g)} · {usd(g.amount)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field id="units" label={t("units")} error={fe("units")} required>
                  <Input type="number" min={1} value={building.units} onChange={(e) => setBuilding({ ...building, units: e.target.value })} />
                </Field>
                <Field id="floors" label={t("floors")} error={fe("floors")}>
                  <Input type="number" min={0} value={building.floors} onChange={(e) => setBuilding({ ...building, floors: e.target.value })} />
                </Field>
                <Field id="area" label={t("areaM2")} error={fe("areaM2")}>
                  <Input type="number" min={0} value={building.areaM2} onChange={(e) => setBuilding({ ...building, areaM2: e.target.value })} />
                </Field>
              </div>
              <Field id="use" label={t("buildingUse")}>
                <Input value={building.use} maxLength={60} onChange={(e) => setBuilding({ ...building, use: e.target.value })} />
              </Field>
            </>
          )
        }
      </FormDialog>

      <FormDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("removeBuilding")}
        description={t("removeBuildingBody")}
        confirmLabel={t("remove")}
        destructive
        successMessage={t("saved")}
        submit={() => removeBuildingAction({ id: removing! })}
      />

      <FormDialog
        open={assessOpen}
        onOpenChange={setAssessOpen}
        title={t("issueAssessment", { year })}
        description={t("issueAssessmentBody", { total: preview ? usd(preview.total) : "" })}
        confirmLabel={t("assess")}
        submit={() => assessParcelAction({ parcelId, year })}
        onDone={(d) => toast.success(t("assessmentIssued", { total: usd((d as { total: number }).total) }))}
      />

      <FormDialog
        open={exemption !== null}
        onOpenChange={(o) => !o && setExemption(null)}
        title={t("requestExemption")}
        description={t("requestExemptionBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("exemptionRequested")}
        submit={() =>
          requestExemptionAction({
            parcelId,
            kind: exemption!.kind,
            pct: exemption!.pct,
            reason: exemption!.reason,
            validFrom: exemption!.validFrom,
            validTo: exemption!.validTo || null,
          })
        }
      >
        {(fe) =>
          exemption && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field id="kind" label={t("exemptionKind")}>
                  <NativeSelect value={exemption.kind} onChange={(e) => setExemption({ ...exemption, kind: e.target.value as (typeof KINDS)[number] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`exemptionKinds.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="pct" label={t("pct")} error={fe("pct")} required>
                  <Input type="number" min={1} max={100} value={exemption.pct} onChange={(e) => setExemption({ ...exemption, pct: e.target.value })} />
                </Field>
                <Field id="from" label={t("validFrom")} error={fe("validFrom")} required>
                  <Input type="date" value={exemption.validFrom} onChange={(e) => setExemption({ ...exemption, validFrom: e.target.value })} />
                </Field>
                <Field id="to" label={t("validTo")} error={fe("validTo")}>
                  <Input type="date" value={exemption.validTo} onChange={(e) => setExemption({ ...exemption, validTo: e.target.value })} />
                </Field>
              </div>
              <Field id="reason" label={t("reason")} error={fe("reason")} required>
                <Textarea rows={3} value={exemption.reason} onChange={(e) => setExemption({ ...exemption, reason: e.target.value })} />
              </Field>
            </>
          )
        }
      </FormDialog>

      <FormDialog
        open={appeal !== null}
        onOpenChange={(o) => !o && setAppeal(null)}
        title={t("recordAppeal")}
        description={t("recordAppealBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("appealFiled")}
        submit={() => fileAppealAction({ assessmentId: appeal!.assessmentId, reason: appeal!.reason, requestedTotal: appeal!.requested === "" ? null : appeal!.requested })}
      >
        {(fe) =>
          appeal && (
            <>
              <Field id="reason" label={t("appealReason")} error={fe("reason")} required>
                <Textarea rows={4} value={appeal.reason} onChange={(e) => setAppeal({ ...appeal, reason: e.target.value })} />
              </Field>
              <Field id="requested" label={t("requested")} hint={t("requestedHint")} error={fe("requestedTotal")}>
                <Input type="number" min={0} step="0.01" value={appeal.requested} onChange={(e) => setAppeal({ ...appeal, requested: e.target.value })} />
              </Field>
            </>
          )
        }
      </FormDialog>
    </Card>
  );
}
