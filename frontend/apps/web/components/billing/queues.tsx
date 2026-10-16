"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { decideCreditNoteAction, decidePlanAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { CreditNoteRow, PlanRow } from "@/lib/server/billing";

function DecideDialog({ target, onClose, kind }: { target: { id: string; approve: boolean } | null; onClose: () => void; kind: "credit" | "plan" }) {
  const t = useTranslations("billing");
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setNote("");
        }
      }}
      title={target?.approve ? t("approveTitle") : t("rejectTitle")}
      confirmLabel={target?.approve ? t("approve") : t("reject")}
      destructive={target ? !target.approve : false}
      successMessage={t("decided")}
      submit={() => (kind === "credit" ? decideCreditNoteAction : decidePlanAction)({ id: target!.id, approve: target!.approve, note })}
    >
      {(fe) => (
        <Field id="note" label={target?.approve ? t("noteOptional") : t("reason")} error={fe("note")} required={!target?.approve}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </FormDialog>
  );
}

export function CreditNoteQueue({ rows, me, canDecide }: { rows: CreditNoteRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const [target, setTarget] = useState<{ id: string; approve: boolean } | null>(null);
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noCreditNotes")} description={t("noCreditNotesBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("number")}</TableHead>
            <TableHead>{t("invoice")}</TableHead>
            <TableHead className="text-end">{t("amount")}</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Mono>{r.number}</Mono>
              </TableCell>
              <TableCell>
                <Link href={`/invoices/${r.invoice?.id}`} className="hover:text-primary">
                  <Mono>{r.invoice?.number}</Mono>
                </Link>
                <span className="block text-xs text-muted-foreground">{r.invoice?.parcel?.pun}</span>
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{format.number(Number(r.amount), { style: "currency", currency: "USD" })}</TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-sm">{t(`decision.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="text-end whitespace-nowrap">
                  {r.status === "pending" && r.requested_by !== me && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, approve: false })}>
                        {t("reject")}
                      </Button>
                      <Button size="sm" onClick={() => setTarget({ id: r.id, approve: true })}>
                        {t("approve")}
                      </Button>
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DecideDialog target={target} onClose={() => setTarget(null)} kind="credit" />
    </>
  );
}

export function PlanQueue({ rows, me, canDecide }: { rows: PlanRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const [target, setTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noPlans")} description={t("noPlansBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("number")}</TableHead>
            <TableHead>{t("parcel")}</TableHead>
            <TableHead className="text-end">{t("total")}</TableHead>
            <TableHead>{t("schedule")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Mono>{r.number}</Mono>
              </TableCell>
              <TableCell>
                <Link href={`/parcels/${r.parcel?.id}`} className="hover:text-primary">
                  <Mono>{r.parcel?.pun ?? "—"}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(r.total)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t("scheduleLine", { n: r.instalments, amount: usd(r.payment_plan_installments[0]?.amount ?? 0), date: format.dateTime(new Date(r.start_date), { dateStyle: "medium" }) })}
              </TableCell>
              <TableCell className="text-sm">{t(`planStatus.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="text-end whitespace-nowrap">
                  {r.status === "pending" && r.requested_by !== me && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, approve: false })}>
                        {t("reject")}
                      </Button>
                      <Button size="sm" onClick={() => setTarget({ id: r.id, approve: true })}>
                        {t("approve")}
                      </Button>
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DecideDialog target={target} onClose={() => setTarget(null)} kind="plan" />
    </>
  );
}
