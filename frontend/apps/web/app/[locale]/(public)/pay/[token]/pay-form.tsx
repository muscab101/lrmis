"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { intentStatusAction, simulateTestPaymentAction, startPaymentAction } from "@/app/[locale]/(public)/pay/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

/** Pay now: choose mobile money or card, approve, and watch the result arrive. */
export function PayForm({ token, providers, initialIntent }: { token: string; providers: { code: string; name: string; method: string }[]; initialIntent: string | null }) {
  const t = useTranslations("pay");
  const locale = useLocale() as "so" | "en";
  const vm = useValidationMessage();
  const router = useRouter();
  const [provider, setProvider] = useState(providers[0]?.code ?? "");
  const [phone, setPhone] = useState("+252");
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

  if (providers.length === 0) return <Alert tone="info" title={t("onlineSoon")}>{t("onlineSoonBody")}</Alert>;

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

  return (
    <div className="space-y-4">
      <FormError error={error && !error.fieldErrors ? error : null} />
      <Field id="provider" label={t("payWith")} error={vm(error?.fieldErrors?.provider?.[0])}>
        <NativeSelect value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {method === "mobile_money" && (
        <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(error?.fieldErrors?.phone?.[0])} required>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Field>
      )}
      <Button
        className="w-full"
        size="lg"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await startPaymentAction({ token, provider, phone: method === "mobile_money" ? phone : "", locale });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          if (res.data.redirect) {
            window.location.assign(res.data.redirect);
            return;
          }
          setIntent(res.data.intentId);
        }}
      >
        {t("payNow")}
      </Button>
    </div>
  );
}
