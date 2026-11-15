"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { Check, Copy, CreditCard, Landmark, Loader2, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { detectWallet, WALLET_NAMES } from "@/lib/payments/wallets";
import { intentStatusAction, simulateTestPaymentAction, startBillsPaymentAction, startPaymentAction } from "@/app/[locale]/(public)/pay/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { BankAccount } from "@/lib/server/bank-account";
import type { Wallet } from "@/lib/payments/wallets";

type Way = "mobile_money" | "card" | "bank_transfer";
const WALLETS: Wallet[] = ["evc_plus", "zaad", "sahal", "edahab"];

/**
 * Pay now, every way but cash: mobile money (EVC Plus, Zaad, Sahal, eDahab), card, or a bank transfer with the
 * reference to write. Online payments are approved and watched here; a transfer is matched when the bank sends it.
 */
export function PayForm({
  token,
  invoiceIds,
  providers,
  initialIntent,
  transfers,
  bank,
}: {
  /** One bill (its pay link) … */
  token?: string;
  /** … or several of the signed-in citizen's bills, paid together. */
  invoiceIds?: string[];
  providers: { code: string; name: string; method: string }[];
  initialIntent: string | null;
  /** Bank transfers: one per property, with the reference to write (the PUN, else the bill number) and its amount. */
  transfers: { reference: string; amount: string }[];
  bank: BankAccount | null;
}) {
  const t = useTranslations("pay");
  const locale = useLocale() as "so" | "en";
  const vm = useValidationMessage();
  const router = useRouter();
  // One provider per way: mobile money goes through WaafiPay (or the test provider while developing), cards through Stripe.
  const mobileProvider = providers.find((p) => p.method === "mobile_money" && p.code !== "test") ?? providers.find((p) => p.method === "mobile_money");
  const cardProvider = providers.find((p) => p.method === "card");
  const available: Record<Way, boolean> = { mobile_money: !!mobileProvider, card: !!cardProvider, bank_transfer: !!bank };
  const [way, setWay] = useState<Way | null>((["mobile_money", "card", "bank_transfer"] as const).find((w) => available[w]) ?? null);
  const provider = way === "card" ? (cardProvider?.code ?? "") : (mobileProvider?.code ?? "");
  const [phone, setPhone] = useState("+252");
  const detected = detectWallet(phone);
  const [chosenWallet, setChosenWallet] = useState<Wallet>("evc_plus");
  const wallet = detected ?? chosenWallet;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [intent, setIntent] = useState<string | null>(initialIntent);
  const [status, setStatus] = useState<{ status: string; receipt_no: string | null; failure_reason: string | null } | null>(null);
  const method = providers.find((p) => p.code === provider)?.method;

  // Poll the intent until it settles.
  useEffect(() => {
    if (!intent) return;
    let stop = false;
    const tick = async () => {
      const res = await intentStatusAction({ intentId: intent });
      if (stop || !res.ok || !res.data) return;
      setStatus(res.data);
      if (res.data.status === "pending") setTimeout(tick, 2500);
      else if (res.data.status === "succeeded") router.refresh();
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [intent, router]);

  if (!way) return <Alert tone="info" title={t("onlineSoon")}>{t("onlineSoonBody")}</Alert>;

  if (intent && status) {
    if (status.status === "succeeded")
      return (
        <Alert tone="success" title={t("paidTitle")}>
          {t("paidBody")} <Mono>{status.receipt_no}</Mono>
        </Alert>
      );
    if (status.status === "pending")
      return (
        <div className="space-y-3">
          <Alert tone="info" title={t("waitingTitle")}>
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {method === "card" ? t("waitingCard") : t("waitingPhone")}
            </span>
          </Alert>
          {provider === "test" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void simulateTestPaymentAction({ intentId: intent, succeed: true })}>
                {t("simulateSuccess")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void simulateTestPaymentAction({ intentId: intent, succeed: false })}>
                {t("simulateFailure")}
              </Button>
            </div>
          )}
        </div>
      );
    return (
      <div className="space-y-3">
        <Alert tone="warning" title={status.status === "expired" ? t("expiredTitle") : t("failedTitle")}>
          {status.failure_reason ?? t("tryAgain")}
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            setIntent(null);
            setStatus(null);
          }}
        >
          {t("tryAgainButton")}
        </Button>
      </div>
    );
  }

  const ICONS: Record<Way, typeof Smartphone> = { mobile_money: Smartphone, card: CreditCard, bank_transfer: Landmark };
  return (
    <div className="space-y-4">
      <FormError error={error && !error.fieldErrors ? error : null} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("payWith")}</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {(["mobile_money", "card", "bank_transfer"] as const).map((w) => {
            const Icon = ICONS[w];
            const on = way === w;
            return (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!available[w]}
                onClick={() => {
                  setWay(w);
                  setError(null);
                }}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? "border-primary bg-primary-soft ring-primary/30 ring-2" : "hover:bg-muted/60"
                }`}
              >
                <Icon className={`size-5 ${on ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
                <span className="font-medium">{t(`way_${w}`)}</span>
                <span className="text-muted-foreground text-xs">{available[w] ? t(`wayHint_${w}`) : t("wayOff")}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {way === "mobile_money" && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("wallet")}>
            {WALLETS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={wallet === w}
                onClick={() => setChosenWallet(w)}
                disabled={!!detected && detected !== w}
                className={`rounded-full border px-3 py-1 text-sm disabled:opacity-40 ${wallet === w ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60"}`}
              >
                {WALLET_NAMES[w]}
              </button>
            ))}
          </div>
          <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(error?.fieldErrors?.phone?.[0])} required>
            <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
          <p className="text-muted-foreground -mt-2 text-sm" aria-live="polite">
            {detected ? t("walletDetected", { wallet: WALLET_NAMES[detected] }) : t("walletList")}
          </p>
        </>
      )}

      {way === "card" && <p className="text-muted-foreground text-sm">{t("cardBody")}</p>}

      {way === "bank_transfer" && bank && (
        <div className="space-y-3">
          <dl className="divide-y rounded-lg border text-sm">
            {(
              [
                [t("bankName"), bank.bank],
                [t("bankAccountName"), bank.account_name],
                [t("bankAccountNo"), bank.account_no, true],
                [t("bankBranch"), bank.branch],
                [t("bankSwift"), bank.swift, true],
              ] as [string, string, boolean?][]
            )
              .filter(([, v]) => v)
              .map(([label, value, copy]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="flex items-center gap-1.5 text-end">
                    {copy ? <Mono>{value}</Mono> : value}
                    {copy && <CopyValue value={value} label={t("copy")} />}
                  </dd>
                </div>
              ))}
          </dl>
          {transfers.length > 1 && <p className="text-sm font-medium">{t("bankOnePerProperty", { count: transfers.length })}</p>}
          <ul className="divide-y rounded-lg border text-sm">
            {transfers.map((x) => (
              <li key={x.reference} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("bankReference")}</span>
                  <Mono>{x.reference}</Mono>
                  <CopyValue value={x.reference} label={t("copy")} />
                </span>
                <span className="font-medium tabular-nums">{x.amount}</span>
              </li>
            ))}
          </ul>
          <Alert tone="info" title={transfers.length === 1 ? t("bankWriteReference", { reference: transfers[0]!.reference }) : t("bankWriteReferences")}>
            {t("bankBody")}
          </Alert>
        </div>
      )}

      {way !== "bank_transfer" && (
        <Button
          className="w-full"
          size="lg"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const phoneArg = way === "mobile_money" ? phone : "";
            const res = invoiceIds?.length
              ? await startBillsPaymentAction({ invoiceIds, provider, phone: phoneArg, locale })
              : await startPaymentAction({ token: token ?? "", provider, phone: phoneArg, locale });
            setBusy(false);
            if (!res.ok) return setError(res.error);
            if (res.data.redirect) {
              window.location.assign(res.data.redirect);
              return;
            }
            setIntent(res.data.intentId);
          }}
        >
          {way === "card" ? t("payByCard") : t("payNow")}
        </Button>
      )}
    </div>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground rounded p-1"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
