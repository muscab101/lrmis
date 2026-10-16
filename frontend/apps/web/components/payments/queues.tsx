"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  approveShiftAction,
  decideReversalAction,
  matchPaymentAction,
  reconcileAction,
  recordBankPaymentAction,
  toggleProviderAction,
} from "@/app/[locale]/(staff)/payments/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { PaymentRow, ReversalRow, ShiftRow } from "@/lib/server/payments";

const usdFmt = (format: ReturnType<typeof useFormatter>) => (n: number | null) => (n == null ? "—" : format.number(Number(n), { style: "currency", currency: "USD" }));

export function UnmatchedList({ rows, canMatch }: { rows: PaymentRow[]; canMatch: boolean }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  const [target, setTarget] = useState<PaymentRow | null>(null);
  const [pun, setPun] = useState("");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noUnmatched")} description={t("noUnmatchedBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("receipt")}</TableHead>
            <TableHead>{t("provider")}</TableHead>
            <TableHead>{t("reference")}</TableHead>
            <TableHead className="text-end">{t("amount")}</TableHead>
            <TableHead>{t("received")}</TableHead>
            {canMatch && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/payments/${r.id}`} className="hover:text-primary">
                  <Mono>{r.receipt_no}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-sm">{r.provider}</TableCell>
              <TableCell className="text-sm">
                <Mono>{r.reference ?? r.provider_ref}</Mono>
                {r.payer_phone && <span className="block text-xs text-muted-foreground">{r.payer_phone}</span>}
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(r.amount_base)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{format.dateTime(new Date(r.received_at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
              {canMatch && (
                <TableCell className="text-end">
                  <Button size="sm" onClick={() => setTarget(r)}>
                    {t("match")}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setPun("");
          }
        }}
        title={t("matchTitle")}
        description={target ? t("matchBody", { receipt: target.receipt_no, amount: usd(target.amount_base) }) : ""}
        confirmLabel={t("match")}
        successMessage={t("matched")}
        submit={() => matchPaymentAction({ id: target!.id, pun })}
      >
        {(fe) => (
          <Field id="pun" label={t("pun")} error={fe("pun")} required>
            <Input value={pun} onChange={(e) => setPun(e.target.value)} className="font-mono" />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

export function ReversalQueue({ rows, me, canDecide }: { rows: ReversalRow[]; me: string; canDecide: boolean }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  const [target, setTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noReversals")} description={t("noReversalsBody")} />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("receipt")}</TableHead>
            <TableHead>{t("pun")}</TableHead>
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
                <Link href={`/payments/${r.payment?.id}`} className="hover:text-primary">
                  <Mono>{r.payment?.receipt_no}</Mono>
                </Link>
              </TableCell>
              <TableCell>
                <Mono>{r.payment?.parcel?.pun ?? "—"}</Mono>
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(r.payment?.amount_base ?? null)}</TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-sm">{t(`decision.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="text-end whitespace-nowrap">
                  {r.status === "pending" && r.requested_by !== me && (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, approve: false })}>
                        {t("reject")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setTarget({ id: r.id, approve: true })}>
                        {t("approveReversal")}
                      </Button>
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setNote("");
          }
        }}
        title={target?.approve ? t("approveReversalTitle") : t("rejectReversalTitle")}
        description={target?.approve ? t("approveReversalBody") : ""}
        confirmLabel={target?.approve ? t("approveReversal") : t("reject")}
        destructive={target?.approve}
        successMessage={t("decided")}
        submit={() => decideReversalAction({ id: target!.id, approve: target!.approve, note })}
      >
        {(fe) => (
          <Field id="note" label={target?.approve ? t("noteOptional") : t("reason")} error={fe("note")} required={!target?.approve}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

export function ShiftApprovals({ rows, me, canApprove }: { rows: ShiftRow[]; me: string; canApprove: boolean }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  const router = useRouter();
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noShifts")} description={t("noShiftsBody")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("shift")}</TableHead>
          <TableHead>{t("pointOfSale")}</TableHead>
          <TableHead className="text-end">{t("expected")}</TableHead>
          <TableHead className="text-end">{t("counted")}</TableHead>
          <TableHead className="text-end">{t("difference")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          {canApprove && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Mono>{s.number}</Mono>
              <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(s.opened_at), { dateStyle: "medium", timeStyle: "short" })}</span>
            </TableCell>
            <TableCell className="text-sm">{s.pos?.name}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(s.expected_cash)}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(s.counted_cash)}</TableCell>
            <TableCell className={`text-end text-sm tabular-nums ${Number(s.difference ?? 0) !== 0 ? "text-status-rejected" : ""}`}>
              {usd(s.difference)}
              {s.close_note && <span className="block text-xs text-muted-foreground">{s.close_note}</span>}
            </TableCell>
            <TableCell className="text-sm">{t(`shiftStatus.${s.status}`)}</TableCell>
            {canApprove && (
              <TableCell className="text-end">
                {s.status === "closed" && s.cashier_id !== me && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      const res = await approveShiftAction({ id: s.id });
                      if (res.ok) {
                        toast.success(t("shiftApproved"));
                        router.refresh();
                      } else toast.error(t("actionFailed"));
                    }}
                  >
                    {t("approve")}
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ProviderToggles({ providers, configured, canEdit }: { providers: { code: string; name: string; enabled: boolean }[]; configured: Record<string, boolean | undefined>; canEdit: boolean }) {
  const t = useTranslations("payments");
  const router = useRouter();
  return (
    <ul className="divide-y">
      {providers.map((p) => (
        <li key={p.code} className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {configured[p.code] === undefined ? t("providerOffline") : configured[p.code] ? t("providerConfigured") : t("providerNotConfigured")}
            </p>
          </div>
          <Switch
            checked={p.enabled}
            disabled={!canEdit}
            aria-label={p.name}
            onCheckedChange={async (on) => {
              const res = await toggleProviderAction({ code: p.code, enabled: on });
              if (res.ok) router.refresh();
              else toast.error(t("actionFailed"));
            }}
          />
        </li>
      ))}
    </ul>
  );
}

export function ReconcileButton({ providers }: { providers: { code: string; name: string }[] }) {
  const t = useTranslations("payments");
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ provider: providers[0]?.code ?? "", from: today, to: today, csv: "" });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("newReconciliation")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("newReconciliation")}
        description={t("reconcileBody")}
        confirmLabel={t("compare")}
        submit={() => reconcileAction(v)}
        onDone={(d) => router.push(`/payments?tab=reconciliation&batch=${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field id="provider" label={t("provider")}>
                <NativeSelect value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })}>
                  {providers.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="from" label={t("from")}>
                <Input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
              </Field>
              <Field id="to" label={t("to")}>
                <Input type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />
              </Field>
            </div>
            <Field id="csv" label={t("settlementCsv")} hint={t("settlementCsvHint")} error={fe("csv")} required>
              <Textarea rows={6} className="font-mono text-xs" value={v.csv} onChange={(e) => setV({ ...v, csv: e.target.value })} placeholder={"provider_ref,amount,date\nTX-123,25.00,2026-10-16"} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}

export function BankPaymentButton() {
  const t = useTranslations("payments");
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ pun: "", amount: "", currency: "USD" as "USD" | "SOS", method: "bank_transfer" as "bank_transfer" | "cheque", reference: "", receivedOn: today });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("recordBank")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("recordBank")}
        description={t("recordBankBody")}
        confirmLabel={t("record")}
        successMessage={t("recorded")}
        submit={() => recordBankPaymentAction(v)}
      >
        {(fe) => (
          <>
            <Field id="pun" label={t("punOptional")} hint={t("punOptionalHint")} error={fe("pun")}>
              <Input value={v.pun} onChange={(e) => setV({ ...v, pun: e.target.value })} className="font-mono" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field id="amount" label={t("amount")} error={fe("amount")} required>
                <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
              </Field>
              <Field id="currency" label={t("currency")} error={fe("currency")}>
                <NativeSelect value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value as "USD" | "SOS" })}>
                  <option value="USD">USD</option>
                  <option value="SOS">SOS</option>
                </NativeSelect>
              </Field>
              <Field id="method" label={t("method")}>
                <NativeSelect value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as "bank_transfer" | "cheque" })}>
                  <option value="bank_transfer">{t("methods.bank_transfer")}</option>
                  <option value="cheque">{t("methods.cheque")}</option>
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field id="ref" label={t("bankReference")} error={fe("reference")} required>
                <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
              </Field>
              <Field id="date" label={t("receivedOn")} error={fe("receivedOn")} required>
                <Input type="date" value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} />
              </Field>
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}
