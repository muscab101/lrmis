import "server-only";
import { hmacHex, safeEqualHex } from "./crypto";
import type { CheckoutInput, CheckoutResult, PaymentProvider, ProviderEvent } from "./types";

/**
 * Stripe Checkout for diaspora card payments. Only usable if the administration has an entity or partner
 * in a Stripe-supported country (Somalia isn't one) — see docs/open-questions.md. No card data touches us.
 */
const key = () => process.env.STRIPE_SECRET_KEY;
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET;
const TOLERANCE_S = 300;

export const stripe: PaymentProvider = {
  code: "stripe",
  configured: () => !!(key() && webhookSecret()),

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(Math.round(input.amount * 100)),
      "line_items[0][price_data][product_data][name]": `${input.invoiceNumber} · ${input.pun}`,
      client_reference_id: input.intentId,
      "metadata[intent_id]": input.intentId,
      "payment_intent_data[metadata][intent_id]": input.intentId,
      success_url: `${input.returnUrl}?intent=${input.intentId}`,
      cancel_url: input.returnUrl,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": input.intentId },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !json.id || !json.url) throw new Error(`stripe checkout: ${json.error?.message ?? res.status}`);
    return { kind: "redirect", providerRef: json.id, url: json.url };
  },

  /**
   * Stripe-Signature: t=<ts>,v1=<hmac(secret, `${t}.${body}`)>[,v1=…], within 5 minutes.
   * Several v1 values appear while a webhook secret is being rolled; any one may match.
   */
  verifyWebhook(headers, rawBody) {
    const secret = webhookSecret();
    const pairs = (headers.get("stripe-signature") ?? "").split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    });
    const t = Number(pairs.find(([k]) => k === "t")?.[1]);
    const sigs = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!secret || !t || sigs.length === 0 || Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return false;
    const expected = hmacHex(secret, `${t}.${rawBody}`);
    return sigs.some((v) => /^[0-9a-f]{64}$/i.test(v) && safeEqualHex(expected, v));
  },

  parseWebhook(rawBody): ProviderEvent | null {
    const ev = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: { object: { id: string; amount_total?: number; currency?: string; payment_status?: string; metadata?: { intent_id?: string } } };
    };
    const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"];
    if (!handled.includes(ev.type)) return null;
    const s = ev.data.object;
    // "completed" with payment_status "unpaid" means a delayed method; the async_* event settles it later.
    if (ev.type === "checkout.session.completed" && s.payment_status !== "paid") return null;
    return {
      eventId: ev.id,
      status: (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") && s.payment_status === "paid" ? "succeeded" : "failed",
      providerRef: s.id,
      intentId: s.metadata?.intent_id,
      amount: (s.amount_total ?? 0) / 100,
      currency: (s.currency ?? "usd").toUpperCase(),
    };
  },
};
