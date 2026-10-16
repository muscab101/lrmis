"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { assessNeighbourhoodAction, decideAppealAction, decideExemptionAction } from "@/app/[locale]/(staff)/valuation/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { AppealRow, ExemptionRow } from "@/lib/server/valuation";
import type { ComboOption } from "@dhulka/ui/combobox";
import { NeighbourhoodPicker } from "./neighbourhood-picker";

export function ExemptionQueue({ rows, me, canDecide }: { rows: ExemptionRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("valuation");
  const format = useFormatter();
  const [decide, setDecide] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noExemptions")} description={t("noExemptionsBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("parcel")}</TableHead>
            <TableHead>{t("exemptionKind")}</TableHead>
            <TableHead className="text-end">%</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("period")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/parcels/${r.parcel?.id}`} className="hover:text-primary">
                  <Mono>{r.parcel?.pun ?? "—"}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-sm">{t(`exemptionKinds.${r.kind}`)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{Number(r.pct)}</TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                {format.dateTime(new Date(r.valid_from), { dateStyle: "medium" })} – {r.valid_to ? format.dateTime(new Date(r.valid_to), { dateStyle: "medium" }) : t("openEnded")}
              </TableCell>
              <TableCell className="text-sm">{t(`decision.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="text-end whitespace-nowrap">
                  {r.status === "pending" && r.requested_by !== me && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDecide({ id: r.id, approve: false })}>
                        {t("reject")}
                      </Button>
                      <Button size="sm" onClick={() => setDecide({ id: r.id, approve: true })}>
                        {t("approve")}
                      </Button>
                    </span>
                  )}
                  {r.status === "pending" && r.requested_by === me && <span className="text-xs text-muted-foreground">{t("needsSomeoneElse")}</span>}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={decide !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDecide(null);
            setNote("");
          }
        }}
        title={decide?.approve ? t("approveExemption") : t("rejectExemption")}
        confirmLabel={decide?.approve ? t("approve") : t("reject")}
        destructive={decide ? !decide.approve : false}
        successMessage={t("decided")}
        submit={() => decideExemptionAction({ id: decide!.id, approve: decide!.approve, note })}
      >
        {(fe) => (
          <Field id="note" label={decide?.approve ? t("noteOptional") : t("reason")} error={fe("note")} required={!decide?.approve}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

export function AppealQueue({ rows, me, canDecide }: { rows: AppealRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("valuation");
  const format = useFormatter();
  const [decide, setDecide] = useState<AppealRow | null>(null);
  const [status, setStatus] = useState<"upheld" | "rejected">("upheld");
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noAppeals")} description={t("noAppealsBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("assessment")}</TableHead>
            <TableHead>{t("parcel")}</TableHead>
            <TableHead className="text-end">{t("assessed")}</TableHead>
            <TableHead className="text-end">{t("requested")}</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Mono>{r.assessment?.number}</Mono>
              </TableCell>
              <TableCell>
                <Link href={`/parcels/${r.parcel?.id}`} className="hover:text-primary">
                  <Mono>{r.parcel?.pun ?? "—"}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{r.assessment ? usd(r.assessment.total) : "—"}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{r.requested_total != null ? usd(r.requested_total) : "—"}</TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-sm">
                {t(`appealStatus.${r.status}`)}
                <div className="text-xs text-muted-foreground">{format.relativeTime(new Date(r.filed_at))}</div>
              </TableCell>
              {canDecide && (
                <TableCell className="text-end">
                  {r.status === "open" && r.filed_by !== me && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setDecide(r);
                        setStatus("upheld");
                        setTotal(r.requested_total != null ? String(r.requested_total) : "");
                        setNote("");
                      }}
                    >
                      {t("decide")}
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={decide !== null}
        onOpenChange={(o) => !o && setDecide(null)}
        title={t("decideAppeal")}
        description={decide?.assessment ? t("decideAppealBody", { number: decide.assessment.number, total: usd(decide.assessment.total) }) : ""}
        confirmLabel={t("saveDecision")}
        successMessage={t("decided")}
        submit={() => decideAppealAction({ id: decide!.id, status, newTotal: status === "upheld" ? total : null, note })}
      >
        {(fe) => (
          <>
            <Field id="decision" label={t("decision.label")}>
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as "upheld" | "rejected")}>
                <option value="upheld">{t("appealStatus.upheld")}</option>
                <option value="rejected">{t("appealStatus.rejected")}</option>
              </NativeSelect>
            </Field>
            {status === "upheld" && (
              <Field id="newTotal" label={t("newTotal")} hint={t("newTotalHint")} error={fe("newTotal")} required>
                <Input type="number" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
              </Field>
            )}
            <Field id="note" label={t("reason")} error={fe("note")} required>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}

export function AssessNeighbourhoodButton() {
  const t = useTranslations("valuation");
  const [open, setOpen] = useState(false);
  const [nbhd, setNbhd] = useState<ComboOption | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("assessNeighbourhood")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("assessNeighbourhood")}
        description={t("assessNeighbourhoodBody")}
        confirmLabel={t("assess")}
        submit={() => assessNeighbourhoodAction({ neighbourhoodId: nbhd?.value ?? "", year })}
        onDone={(d) => {
          const r = d as { assessed: number; skipped: number };
          toast.success(t("assessedCount", { assessed: r.assessed, skipped: r.skipped }));
        }}
      >
        {(fe) => (
          <>
            <Field id="nbhd" label={t("neighbourhood")} error={fe("neighbourhoodId")} required>
              <div>
                <NeighbourhoodPicker value={nbhd} onChange={setNbhd} />
              </div>
            </Field>
            <Field id="year" label={t("year")} error={fe("year")} required>
              <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
