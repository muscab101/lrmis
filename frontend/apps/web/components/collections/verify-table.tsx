"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Paperclip, PenLine } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { disputePaymentAction, verifyPaymentsAction } from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import type { QueueRow } from "@/lib/server/collections";
import { VerifyStatusBadge } from "./verify-status";

/** Payments to check: tick the ones whose money you've seen and verify them together, or dispute one. */
export function VerifyTable({ rows, canVerify, me }: { rows: QueueRow[]; canVerify: boolean; me: string }) {
  const t = useTranslations("collections");
  const tp = useTranslations("payments");
  const format = useFormatter();
  const locale = useLocale();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  // A cashier's own takings can't be ticked by them.
  const tickable = rows.filter((r) => canVerify && r.cashier_id !== me && (r.verify_status === "pending" || r.verify_status === "disputed"));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [note, setNote] = useState("");
  const [dispute, setDispute] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");
  const chosen = rows.filter((r) => picked.has(r.payment_id));
  const total = chosen.reduce((s, r) => s + r.amount, 0);
  const anyDisputed = chosen.some((r) => r.verify_status === "disputed");
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const how = (r: QueueRow) => (r.wallet && tp.has(`wallets.${r.wallet}`) ? tp(`wallets.${r.wallet}`) : tp.has(`methods.${r.method}`) ? tp(`methods.${r.method}`) : r.method);

  return (
    <>
      {canVerify && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
          <span className="text-muted-foreground">{t("verify.picked", { count: chosen.length, amount: usd(total) })}</span>
          <Button size="sm" disabled={chosen.length === 0} onClick={() => setVerifying(true)}>
            {t("verify.verifySelected")}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canVerify && (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label={t("verify.all")}
                  checked={tickable.length > 0 && tickable.every((r) => picked.has(r.payment_id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(tickable.map((r) => r.payment_id)) : new Set())}
                />
              </TableHead>
            )}
            <TableHead>{tp("receipt")}</TableHead>
            <TableHead>{tp("received")}</TableHead>
            <TableHead>{t("cashier")}</TableHead>
            <TableHead>{tp("method")}</TableHead>
            <TableHead>{tp("reference")}</TableHead>
            <TableHead className="text-end">{t("expected")}</TableHead>
            <TableHead className="text-end">{tp("amount")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const gap = r.expected_amount === null ? 0 : Math.round((r.amount - r.expected_amount) * 100) / 100;
            const can = tickable.includes(r);
            return (
              <TableRow key={r.payment_id}>
                {canVerify && (
                  <TableCell>
                    <input type="checkbox" aria-label={r.receipt_no} disabled={!can} checked={picked.has(r.payment_id)} onChange={() => toggle(r.payment_id)} />
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/payments/${r.payment_id}`} className="text-primary hover:underline">
                    <Mono>{r.receipt_no}</Mono>
                  </Link>
                  {r.pun && <span className="block font-mono text-xs text-muted-foreground">{r.pun}</span>}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">{format.dateTime(new Date(r.received_at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                <TableCell className="text-sm">
                  {r.cashier ?? t("online")}
                  <span className="block text-xs text-muted-foreground">{locale === "so" ? r.district_so : r.district_en}</span>
                </TableCell>
                <TableCell className="text-sm">{how(r)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.reference ?? "—"}
                  {r.evidence > 0 && <Paperclip className="ms-1 inline size-3.5 text-muted-foreground" aria-label={t("evidence.title")} />}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{r.expected_amount === null ? "—" : usd(r.expected_amount)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {usd(r.amount)}
                  {gap !== 0 && r.expected_amount !== null && (
                    <span className={`block text-xs ${gap > 0 ? "text-status-pending" : "text-status-rejected"}`}>{gap > 0 ? t("over", { amount: usd(gap) }) : t("under", { amount: usd(-gap) })}</span>
                  )}
                </TableCell>
                <TableCell>
                  <VerifyStatusBadge status={r.verify_status} />
                  {r.correction_pending && <span className="mt-1 block text-xs text-status-pending">{t("corrections.pendingShort")}</span>}
                  {r.dispute_reason && <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{r.dispute_reason}</span>}
                </TableCell>
                <TableCell className="text-end">
                  {canVerify && r.cashier_id !== me && r.verify_status !== "reconciled" && r.verify_status !== "disputed" && (
                    <Button size="sm" variant="ghost" onClick={() => setDispute(r)}>
                      <PenLine aria-hidden />
                      {t("verify.dispute")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <FormDialog
        open={verifying}
        onOpenChange={setVerifying}
        title={t("verify.confirmTitle", { count: chosen.length })}
        description={t("verify.confirmBody", { amount: usd(total) })}
        confirmLabel={t("verify.verifySelected")}
        submit={() => verifyPaymentsAction({ ids: chosen.map((r) => r.payment_id), note })}
        successMessage={t("verify.done")}
        onDone={() => {
          setPicked(new Set());
          setNote("");
        }}
      >
        {(fe) => (
          <Field id="verifyNote" label={anyDisputed ? t("verify.noteDisputed") : t("verify.note")} error={fe("note")} required={anyDisputed}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dispute !== null}
        onOpenChange={(o) => !o && setDispute(null)}
        title={t("verify.disputeTitle", { receipt: dispute?.receipt_no ?? "" })}
        description={t("verify.disputeBody")}
        confirmLabel={t("verify.dispute")}
        destructive
        submit={() => disputePaymentAction({ id: dispute!.payment_id, reason })}
        successMessage={t("verify.disputed")}
        onDone={() => setReason("")}
      >
        {(fe) => (
          <Field id="disputeReason" label={t("verify.reason")} error={fe("reason")} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
