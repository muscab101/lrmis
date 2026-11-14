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
import { useEffect, useState } from "react";
import { closeShiftAction, findParcelAction, openShiftAction, takePaymentAction } from "@/app/[locale]/(staff)/payments/actions";
import { PushPayment } from "@/components/payments/push-payment";
import { FormError } from "@/components/forms/form-error";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { ShiftRow } from "@/lib/server/payments";

const WALLET_HOWS = ["evc_plus", "edahab", "zaad"] as const;
type How = "cash" | "cheque" | "bank_transfer" | (typeof WALLET_HOWS)[number];

type Found = Awaited<ReturnType<typeof findParcelAction>> extends { ok: true; data: infer D } | { ok: false } ? D : never;

export function OpenShift({ points }: { points: { id: string; code: string; name: string }[] }) {
  const t = useTranslations("payments");
  const router = useRouter();
  const [posId, setPosId] = useState(points[0]?.id ?? "");
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
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await openShiftAction({ posId });
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

/** `initialFind`: a PUN, invoice or application number to look up straight away (?find=). */
export function TakePayment({
  shift,
  initialFind = "",
  pushProviders = [],
}: {
  shift: ShiftRow;
  initialFind?: string;
  /** The mobile money providers that can push a payment request to a phone (none until WaafiPay is set up). */
  pushProviders?: { code: string; name: string }[];
}) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const [pun, setPun] = useState(initialFind);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  // How they paid: cash, a wallet (EVC Plus, eDahab, ZAAD — mobile money), a bank transfer or a cheque.
  const [v, setV] = useState({ invoiceId: "", amount: "", currency: "USD" as "USD" | "SOS", how: "cash" as How, payerName: "", payerPhone: "", reference: "" });
  const [askDuplicate, setAskDuplicate] = useState(false);
  const needsRef = v.how !== "cash" && v.how !== "cheque";
  const [receipt, setReceipt] = useState<{ id: string; no: string; leftover: number; discount: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const owed = found?.invoices.reduce((s, i) => s + Number(i.balance), 0) ?? 0;
  const demolishedLand = found?.parcel.building_state === "demolished";
  const partialLand = !!found && !demolishedLand && ["draft", "surveyed", "verified"].includes(found.parcel.status);

  async function find(term = pun) {
    setPun(term);
    setBusy(true);
    setError(null);
    setReceipt(null);
    const res = await findParcelAction({ pun: term });
    setBusy(false);
    if (!res.ok) {
      setFound(null);
      return setError(res.error);
    }
    setFound(res.data);
    // Everything owed is taken at once (the tax bill and its service charge together), even when one bill's number was searched.
    // The payer starts as the land's owner (name and phone), still editable when someone else pays.
    setV((s) => ({
      ...s,
      payerName: res.data.payer.name,
      payerPhone: res.data.payer.phone,
      invoiceId: "",
      amount: String(Math.round(res.data.invoices.reduce((a, i) => a + Number(i.balance), 0) * 100) / 100 || ""),
    }));
  }

  useEffect(() => {
    if (initialFind) void find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pay(confirmDuplicate = false) {
    if (!found) return;
    setBusy(true);
    setError(null);
    setAskDuplicate(false);
    const wallet = (WALLET_HOWS as readonly string[]).includes(v.how) ? (v.how as (typeof WALLET_HOWS)[number]) : null;
    const res = await takePaymentAction({
      invoiceId: v.invoiceId || null,
      amount: v.amount,
      currency: v.currency,
      method: wallet ? "mobile_money" : (v.how as "cash" | "cheque" | "bank_transfer"),
      wallet,
      payerName: v.payerName,
      payerPhone: v.payerPhone,
      reference: v.reference,
      confirmDuplicate,
      shiftId: shift.id,
      parcelId: found.parcel.id,
    });
    setBusy(false);
    if (!res.ok) {
      // The same amount was just taken for this house: ask before taking it twice.
      if (res.error.code === "CONFLICT" && res.error.values?.detail === "possible_duplicate") return setAskDuplicate(true);
      return setError(res.error);
    }
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
              <Input value={pun} onChange={(e) => setPun(e.target.value)} placeholder="3441712 · INV-2026-000001 · APP-2026-000001" className="font-mono" autoComplete="off" />
            </Field>
            <Button type="submit" variant="outline" className="mt-6" loading={busy && !found}>
              <Search aria-hidden />
              {t("find")}
            </Button>
          </form>

          {/* Land not registered yet pays like any other; once its bills are paid it registers by itself. */}
          {partialLand && (
            <Alert tone="info" title={t("partialPaysTitle")} className="border-t">
              {t("partialPaysBody")}
            </Alert>
          )}
          {demolishedLand && (
            <Alert tone="warning" title={t("demolishedLandTitle", { pun: found!.parcel.pun ?? "—" })} className="border-t">
              {t("demolishedLandBody")}
            </Alert>
          )}

          {found && !demolishedLand && found.units.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="font-medium">
                  <Mono>{found.parcel.pun}</Mono>
                </p>
                <p className="text-sm text-muted-foreground">{found.parcel.layout === "house" ? t("oldUnitBills") : t("chooseUnit")}</p>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {found.units.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <Mono>{u.pun}</Mono>
                      <span className="text-muted-foreground"> · {u.owners.join(", ") || "—"}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={`tabular-nums ${u.owed > 0 ? "font-medium text-danger" : ""}`}>{usd(u.owed)}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void find(u.pun ?? "")}>
                        {t("openUnit")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* A house, or a flats building's own open-ground bill (its flats are paid one by one above). */}
          {found && !demolishedLand && (found.units.length === 0 || found.parcel.layout === "house" || (found.parcel.layout === "flats" && found.invoices.length > 0)) && (
            <div className="space-y-4 border-t pt-4">
              <div>
                <p className="font-medium">
                  <Mono>{found.parcel.pun ?? found.parcel.application?.number ?? "—"}</Mono> · {found.owners.join(", ") || (found.parcel.pun ? "—" : t("notYetRegistered"))}
                </p>
                <p className="text-sm text-muted-foreground">{t("owedNow", { amount: usd(owed) })}</p>
              </div>
              {/* Just in case the desk can't take it: ask for the money on the payer's phone. */}
              {found.invoices.length > 0 && !demolishedLand && (
                <PushPayment
                  key={found.parcel.id}
                  billId={v.invoiceId}
                  allowed={found.invoices.some((b) => b.id === v.invoiceId && b.push_ok)}
                  phone={v.payerPhone}
                  providers={pushProviders}
                />
              )}
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
                <Field id="method" label={t("method")} error={fe("wallet")}>
                  <NativeSelect value={v.how} onChange={(e) => setV({ ...v, how: e.target.value as How })}>
                    <option value="cash">{t("methods.cash")}</option>
                    {WALLET_HOWS.map((w) => (
                      <option key={w} value={w}>
                        {t(`wallets.${w}`)}
                      </option>
                    ))}
                    <option value="bank_transfer">{t("methods.bank_transfer")}</option>
                    <option value="cheque">{t("methods.cheque")}</option>
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
                <Field id="ref" label={needsRef ? t("transactionRef") : t("referenceOptional")} hint={needsRef ? t("transactionRefHint") : undefined} error={fe("reference")} required={needsRef}>
                  <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} className="font-mono" autoComplete="off" />
                </Field>
              </div>
              {askDuplicate && (
                <Alert tone="warning" title={t("possibleDuplicate")}>
                  {t("possibleDuplicateBody")}
                  <span className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void pay(true)}>
                      {t("takeAgain")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAskDuplicate(false)}>
                      {t("dontTake")}
                    </Button>
                  </span>
                </Alert>
              )}
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
        submit={() => closeShiftAction({ id: shift.id })}
        successMessage={t("shiftClosed")}
      />
    </div>
  );
}
