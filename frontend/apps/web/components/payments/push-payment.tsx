"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { Smartphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { simulateTestPaymentAction } from "@/app/[locale]/(public)/pay/actions";
import { pushPaymentAction, pushPaymentStatusAction } from "@/app/[locale]/(staff)/payments/actions";
import { useErrorMessage } from "@/lib/client/errors";

/**
 * Cashier: "Push payment", for a bill whose money went wrong (a payment reversed or not approved, or an online payment that
 * failed). One tap asks for the bill's amount on the payer's phone (the phone on the form); they approve it with their
 * PIN. The result shows under the button.
 */
export function PushPayment({
  billId,
  allowed,
  phone,
  providers,
}: {
  billId: string;
  /** The bill's money went wrong before (reversed, not approved, or a failed online payment). */
  allowed: boolean;
  phone: string;
  providers: { code: string; name: string }[];
}) {
  const t = useTranslations("payments.push");
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const provider = providers[0]?.code ?? "";
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ intentId: string; text: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // While waiting, ask every 3 seconds whether the payer approved (for up to 3 minutes).
  useEffect(() => {
    if (!waiting || result) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const res = await pushPaymentStatusAction({ intentId: waiting.intentId });
      const s = res.ok ? res.data : null;
      if (s?.status === "succeeded") {
        const text = t("paid", { receipt: s.receipt_no ?? "—" });
        setResult({ ok: true, text });
        toast.success(text);
        router.refresh();
      } else if (s && ["failed", "cancelled", "expired"].includes(s.status)) {
        setResult({ ok: false, text: s.failure_reason ? t("refusedWhy", { reason: s.failure_reason }) : t("refused") });
      } else if (tries >= 60) {
        setResult({ ok: false, text: t("noAnswer") });
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, result, router, t]);

  const send = async () => {
    if (!provider) return toast.error(t("notConnected"));
    if (!phone.trim()) return toast.error(t("needPhone"));
    setBusy(true);
    setWaiting(null);
    setResult(null);
    const res = await pushPaymentAction({ invoiceId: billId, provider, phone });
    setBusy(false);
    if (!res.ok) return toast.error(errorMessage(res.error));
    setWaiting({ intentId: res.data.intentId, text: t("sent", { amount: usd(res.data.amount), phone }) });
  };

  const pending = waiting && !result;
  return (
    <div className="space-y-1.5">
      <Button type="button" size="sm" loading={busy} disabled={!billId || !allowed || Boolean(pending)} onClick={send}>
        <Smartphone aria-hidden />
        {t("button")}
      </Button>
      {!allowed && !waiting && <p className="text-muted-foreground text-xs">{t("onlyAfterProblem")}</p>}
      {waiting && (
        <p className={`text-xs ${result ? (result.ok ? "text-status-approved" : "text-status-rejected") : "text-muted-foreground"}`}>
          {result ? result.text : `${waiting.text} ${t("waiting")}`}
        </p>
      )}
      {/* Development only: the test provider never reaches a phone, so approve or decline it by hand. */}
      {pending && provider === "test" && (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => void simulateTestPaymentAction({ intentId: waiting.intentId, succeed: true })}>
            {t("simulateYes")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void simulateTestPaymentAction({ intentId: waiting.intentId, succeed: false })}>
            {t("simulateNo")}
          </Button>
        </div>
      )}
    </div>
  );
}
