"use client";

import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { decideCorrectionAction } from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { CorrectionRow } from "@/lib/server/collections";

/** Correction requests: what changes (before → after), why, who asked, and the Finance Manager's decision. */
export function CorrectionsList({ rows, canDecide, me, showReceipt = true }: { rows: CorrectionRow[]; canDecide: boolean; me: string; showReceipt?: boolean }) {
  const t = useTranslations("collections.corrections");
  const tp = useTranslations("payments");
  const format = useFormatter();
  const [deciding, setDeciding] = useState<{ row: CorrectionRow; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const value = (k: string, v: string | null | undefined) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k === "method") return tp.has(`methods.${v}`) ? tp(`methods.${v}`) : v;
    if (k === "wallet") return tp.has(`wallets.${v}`) ? tp(`wallets.${v}`) : v;
    return v;
  };

  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>;
  return (
    <>
      <ul className="divide-y">
        {rows.map((c) => (
          <li key={c.id} className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                <Mono>{c.number}</Mono>
                {showReceipt && c.payment && (
                  <>
                    {" · "}
                    <Link href={`/payments/${c.payment_id}`} className="text-primary hover:underline">
                      <Mono>{c.payment.receipt_no}</Mono>
                    </Link>
                  </>
                )}
              </p>
              <StatusBadge tone={c.status === "pending" ? "pending" : c.status === "approved" ? "approved" : "rejected"}>{t(`status.${c.status}`)}</StatusBadge>
            </div>
            <ul className="grid gap-1">
              {Object.keys(c.changes).map((k) => (
                <li key={k}>
                  <span className="text-muted-foreground">{t(`fields.${k}`)}:</span> <span className="line-through opacity-70">{value(k, c.before[k])}</span> → <span className="font-medium">{value(k, c.changes[k])}</span>
                </li>
              ))}
            </ul>
            <p>
              <span className="text-muted-foreground">{t("reason")}:</span> {c.reason}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("asked", { by: c.requested_by_name ?? "—", at: dt(c.requested_at) })}
              {c.decided_at && ` · ${t("decided", { by: c.decided_by_name ?? "—", at: dt(c.decided_at) })}`}
              {c.decision_note && ` — ${c.decision_note}`}
            </p>
            {canDecide && c.status === "pending" && c.requested_by !== me && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setDeciding({ row: c, approve: true })}>
                  {t("approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeciding({ row: c, approve: false })}>
                  {t("reject")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <FormDialog
        open={deciding !== null}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.approve ? t("approveTitle", { number: deciding.row.number }) : t("rejectTitle", { number: deciding?.row.number ?? "" })}
        description={deciding?.approve ? t("approveBody") : t("rejectBody")}
        confirmLabel={deciding?.approve ? t("approve") : t("reject")}
        destructive={deciding ? !deciding.approve : false}
        submit={() => decideCorrectionAction({ id: deciding!.row.id, approve: deciding!.approve, note })}
        successMessage={deciding?.approve ? t("approved") : t("rejected")}
        onDone={() => setNote("")}
      >
        {(fe) => (
          <Field id="decisionNote" label={deciding?.approve ? t("noteOptional") : t("noteRequired")} error={fe("note")} required={deciding ? !deciding.approve : false}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
