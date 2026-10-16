"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Printer, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { closeShiftAction, findParcelAction, openShiftAction, takePaymentAction } from "@/app/[locale]/(staff)/payments/actions";
import { FormError } from "@/components/forms/form-error";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { ShiftRow } from "@/lib/server/payments";

type Found = Awaited<ReturnType<typeof findParcelAction>> extends { ok: true; data: infer D } | { ok: false } ? D : never;

export function OpenShift({ points }: { points: { id: string; code: string; name: string }[] }) {
  const t = useTranslations("payments");
  const vm = useValidationMessage();
  const router = useRouter();
  const [posId, setPosId] = useState(points[0]?.id ?? "");
  const [float, setFloat] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  if (points.length === 0) return <Alert tone="warning" title={t("noPointsOfSale")}>{t("noPointsOfSaleBody")}</Alert>;
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">{t("openShift")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormError error={error && !error.fieldErrors ? error : null} />
        <Field id="pos" label={t("pointOfSale")} required>
          <NativeSelect value={posId} onChange={(e) => setPosId(e.target.value)}>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="float" label={t("openingFloat")} hint={t("openingFloatHint")} error={vm(error?.fieldErrors?.float?.[0])}>
          <Input type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
        </Field>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await openShiftAction({ posId, float });
            setBusy(false);
            if (!res.ok) return setError(res.error);
            toast.success(t("shiftOpened"));
            router.refresh();
          }}
        >
          {t("openShift")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function TakePayment({ shift }: { shift: ShiftRow }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const [pun, setPun] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ invoiceId: "", amount: "", currency: "USD" as "USD" | "SOS", method: "cash" as "cash" | "cheque" | "bank_transfer", payerName: "", payerPhone: "", reference: "" });
  const [receipt, setReceipt] = useState<{ id: string; no: string; leftover: number; discount: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const owed = found?.invoices.reduce((s, i) => s + Number(i.balance), 0) ?? 0;

  async function find() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    const res = await findParcelAction({ pun });
    setBusy(false);
    if (!res.ok) {
      setFound(null);
      return setError(res.error);
    }
    setFound(res.data);
    setV((s) => ({ ...s, invoiceId: "", amount: String(res.data.invoices.reduce((a, i) => a + Number(i.balance), 0) || "") }));
  }

  async function pay() {
    if (!found) return;
    setBusy(true);
    setError(null);
    const res = await takePaymentAction({ ...v, shiftId: shift.id, parcelId: found.parcel.id, invoiceId: v.invoiceId || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setReceipt({ id: res.data!.payment_id, no: res.data!.receipt_no, leftover: Number(res.data!.leftover), discount: Number(res.data!.discount) });
    setFound(null);
    setPun("");
    toast.success(t("paymentTaken", { receipt: res.data!.receipt_no }));
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("shiftLine", { number: shift.number, pos: shift.pos?.name ?? "", since: format.dateTime(new Date(shift.opened_at), { timeStyle: "short" }) })}
        </p>
        <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
          {t("closeShift")}
        </Button>
      </div>

      {receipt && (
        <Alert tone="success" title={t("receiptReady", { receipt: receipt.no })}>
          {receipt.discount > 0 && <span className="block">{t("discountApplied", { amount: usd(receipt.discount) })}</span>}
          {receipt.leftover > 0 && <span className="block">{t("creditLeft", { amount: usd(receipt.leftover) })}</span>}
          <span className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/payments/${receipt.id}/receipt`} target="_blank">
                <Printer aria-hidden />
                {t("printReceipt")}
              </Link>
            </Button>
          </span>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-5">
          <FormError error={error && !error.fieldErrors ? error : null} />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
          >
            <Field id="pun" label={t("findByPun")} error={fe("pun")} className="flex-1">
              <Input value={pun} onChange={(e) => setPun(e.target.value)} placeholder="BN-HDN-012-000001" className="font-mono" autoComplete="off" />
            </Field>
            <Button type="submit" variant="outline" className="mt-6" loading={busy && !found}>
              <Search aria-hidden />
              {t("find")}
            </Button>
          </form>

          {found && (
            <div className="space-y-4 border-t pt-4">
              <div>
                <p className="font-medium">
                  <Mono>{found.parcel.pun}</Mono> · {found.owners.join(", ") || "—"}
                </p>
                <p className="text-sm text-muted-foreground">{t("owedNow", { amount: usd(owed) })}</p>
              </div>
              {found.invoices.length > 0 && (
                <ul className="divide-y rounded-md border text-sm">
                  {found.invoices.map((i) => (
                    <li key={i.id} className="flex justify-between px-3 py-2">
                      <span>
                        <Mono>{i.number}</Mono> <span className="text-muted-foreground">{i.period}</span>
                        {i.discount_until && i.discount_until >= new Date().toISOString().slice(0, 10) && Number(i.paid) === 0 && (
                          <span className="ms-2 text-xs text-status-approved">{t("discountUntil", { pct: Number(i.early_discount_pct) })}</span>
                        )}
                      </span>
                      <span className="tabular-nums">{usd(i.balance)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
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
                  <NativeSelect value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as typeof v.method })}>
                    <option value="cash">{t("methods.cash")}</option>
                    <option value="cheque">{t("methods.cheque")}</option>
                    <option value="bank_transfer">{t("methods.bank_transfer")}</option>
                  </NativeSelect>
                </Field>
                {found.invoices.length > 1 && (
                  <Field id="invoice" label={t("payFirst")} hint={t("payFirstHint")} className="sm:col-span-3">
                    <NativeSelect value={v.invoiceId} onChange={(e) => setV({ ...v, invoiceId: e.target.value })}>
                      <option value="">{t("oldestFirst")}</option>
                      {found.invoices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.number} · {usd(i.balance)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                <Field id="payer" label={t("payerName")}>
                  <Input value={v.payerName} onChange={(e) => setV({ ...v, payerName: e.target.value })} />
                </Field>
                <Field id="phone" label={t("payerPhone")}>
                  <Input inputMode="tel" value={v.payerPhone} onChange={(e) => setV({ ...v, payerPhone: e.target.value })} />
                </Field>
                <Field id="ref" label={t("referenceOptional")}>
                  <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button loading={busy} onClick={() => void pay()}>
                  {t("takePayment")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={closing}
        onOpenChange={setClosing}
        title={t("closeShift")}
        description={t("closeShiftBody")}
        confirmLabel={t("closeShift")}
        submit={() => closeShiftAction({ id: shift.id, counted, note })}
        onDone={(d) => {
          const r = d as { expected: number; difference: number };
          toast.success(t("shiftClosed", { expected: usd(r.expected), difference: usd(r.difference) }));
        }}
      >
        {(fe2) => (
          <>
            <Field id="counted" label={t("countedCash")} error={fe2("counted")} required>
              <Input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </Field>
            <Field id="note" label={t("closeNote")} hint={t("closeNoteHint")} error={fe2("note")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </div>
  );
}
