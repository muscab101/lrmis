import "server-only";
import { randomUUID } from "node:crypto";
import { hmacHex, safeEqualHex } from "./crypto";
import type { CheckoutInput, CheckoutResult, PaymentProvider, ProviderEvent } from "./types";

/**
 * WaafiPay (EVC Plus, Zaad, Sahal, eDahab). API_PURCHASE pushes a prompt to the payer's phone and answers
 * once they approve or decline, so the result is final when the call returns. Merchant-number / USSD
 * payments arrive as webhooks signed with WAAFIPAY_WEBHOOK_SECRET (HMAC-SHA256 of the body in
 * `x-waafi-signature`) — confirm the exact scheme with WaafiPay when the merchant account is opened.
 */
const env = () => ({
  url: process.env.WAAFIPAY_API_URL ?? "https://api.waafipay.net/asm",
  merchantUid: process.env.WAAFIPAY_MERCHANT_UID,
  apiUserId: process.env.WAAFIPAY_API_USER_ID,
  apiKey: process.env.WAAFIPAY_API_KEY,
  webhookSecret: process.env.WAAFIPAY_WEBHOOK_SECRET,
});

export const waafipay: PaymentProvider = {
  code: "waafipay",
  configured: () => {
    const e = env();
    return !!(e.merchantUid && e.apiUserId && e.apiKey);
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const e = env();
    const body = {
      schemaVersion: "1.0",
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
      channelName: "WEB",
      serviceName: "API_PURCHASE",
      serviceParams: {
        merchantUid: e.merchantUid,
        apiUserId: e.apiUserId,
        apiKey: e.apiKey,
        paymentMethod: "mwallet_account",
        payerInfo: { accountNo: (input.phone ?? "").replace(/^\+/, "") },
        transactionInfo: {
          referenceId: input.intentId,
          invoiceId: input.invoiceNumber,
          amount: input.amount.toFixed(2),
          currency: input.currency,
          description: `${input.invoiceNumber} ${input.pun}`,
        },
      },
    };
    const res = await fetch(e.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      responseCode?: string;
      responseMsg?: string;
      params?: { state?: string; transactionId?: string; txAmount?: string };
    };
    // Only an explicit approval counts; anything else (timeouts, missing state) is a failure the payer can retry.
    const approved = json.responseCode === "2001" && String(json.params?.state ?? "").toUpperCase() === "APPROVED";
    const providerRef = json.params?.transactionId ?? `WAAFI-${input.intentId}-${Date.now()}`;
    return {
      kind: "completed",
      providerRef,
      event: {
        eventId: providerRef,
        status: approved ? "succeeded" : "failed",
        providerRef,
        intentId: input.intentId,
        amount: Number(json.params?.txAmount ?? input.amount),
        currency: input.currency,
        phone: input.phone,
        failureReason: approved ? undefined : (json.responseMsg ?? `HTTP ${res.status}`).slice(0, 200),
      },
    };
  },

  verifyWebhook(headers, rawBody) {
    const secret = env().webhookSecret;
    const sig = headers.get("x-waafi-signature") ?? "";
    return !!secret && /^[0-9a-f]{64}$/i.test(sig) && safeEqualHex(hmacHex(secret, rawBody), sig);
  },

  parseWebhook(rawBody): ProviderEvent | null {
    const b = JSON.parse(rawBody) as { transactionId?: string; state?: string; amount?: string | number; currency?: string; referenceId?: string; accountNo?: string; description?: string };
    if (!b.transactionId) return null;
    return {
      eventId: b.transactionId,
      status: b.state === "APPROVED" ? "succeeded" : "failed",
      providerRef: b.transactionId,
      intentId: /^[0-9a-f-]{36}$/i.test(b.referenceId ?? "") ? b.referenceId : undefined,
      amount: Number(b.amount ?? 0),
      currency: (b.currency ?? "USD").toUpperCase(),
      reference: b.description ?? b.referenceId,
      phone: b.accountNo ? `+${b.accountNo.replace(/^\+/, "")}` : undefined,
    };
  },
};
