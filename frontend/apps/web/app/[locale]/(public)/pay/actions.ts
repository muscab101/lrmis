"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { getProvider, ingestEvent } from "@/lib/server/providers";
import { createAdminClient } from "@/lib/supabase/admin";

const token = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Pay page: start an online payment. Mobile money (WaafiPay) waits for the payer to approve on their phone
 * and returns the final result; cards return a hosted-checkout URL; the test provider waits for a webhook.
 */
const startSchema = z.object({
  token,
  provider: z.string().min(2).max(20),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .default(""),
  locale: z.enum(["so", "en"]),
});

export const startPaymentAction = defineAction(
  "pay.start",
  startSchema,
  async (v, ctx) => {
    const provider = getProvider(v.provider);
    if (!provider || !provider.configured()) throw new AppFailure("VALIDATION", undefined, { provider: ["validation.provider"] });
    let intent: { intent_id: string; amount: number; currency: string; invoice_number: string; pun: string | null };
    try {
      intent = unwrap(
        await ctx.supabase.rpc("payment_intent_create", { p_invoice: null, p_token: v.token, p_provider: v.provider, p_phone: v.phone || null }),
        "intent",
      ) as typeof intent;
    } catch (err) {
      if (err instanceof AppFailure && err.values?.detail === "phone") throw new AppFailure("VALIDATION", undefined, { phone: ["validation.phone_so"] });
      throw err;
    }
    // Back to the site the payer started from; during development that may be another localhost port.
    const origin = (await headers()).get("origin");
    const site = origin && /^http:\/\/localhost:\d+$/.test(origin) ? origin : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    const result = await provider.createCheckout({
      intentId: intent.intent_id,
      invoiceNumber: intent.invoice_number,
      pun: intent.pun,
      amount: Number(intent.amount),
      currency: intent.currency,
      phone: v.phone,
      returnUrl: `${site}/${v.locale}/pay/${v.token}`,
    });
    const admin = await createAdminClient();
    await admin.rpc("payment_intent_set_checkout", { p_id: intent.intent_id, p_provider_ref: result.providerRef, p_checkout_url: result.kind === "redirect" ? result.url : "" });
    if (result.kind === "redirect") return { intentId: intent.intent_id, redirect: result.url };
    if (result.kind === "completed") {
      // The provider answered over our own TLS call, so the result is authentic.
      const out = await ingestEvent(v.provider, result.event, true, { source: "api", event: result.event });
      log("info", "pay.completed", { requestId: ctx.requestId, provider: v.provider, result: out.result });
    }
    return { intentId: intent.intent_id, redirect: null };
  },
  { public: true },
);

export const intentStatusAction = defineAction(
  "pay.status",
  z.object({ intentId: z.uuid() }),
  async ({ intentId }, ctx) => unwrap(await ctx.supabase.rpc("payment_intent_status", { p_id: intentId }), "status") as { status: string; receipt_no: string | null; failure_reason: string | null } | null,
  { public: true },
);

/** Development only: complete a test-provider intent as if the provider had sent the webhook. */
export const simulateTestPaymentAction = defineAction(
  "pay.simulate",
  z.object({ intentId: z.uuid(), succeed: z.boolean() }),
  async ({ intentId, succeed }) => {
    if (!getProvider("test")?.configured()) throw new AppFailure("PERMISSION_DENIED");
    const admin = await createAdminClient();
    const { data } = await admin.from("payment_intents").select("amount, currency, provider_ref, phone").eq("id", intentId).maybeSingle();
    const i = data as { amount: number; currency: string; provider_ref: string; phone: string | null } | null;
    if (!i) throw new AppFailure("NOT_FOUND");
    return ingestEvent(
      "test",
      { eventId: `sim-${intentId}`, status: succeed ? "succeeded" : "failed", providerRef: i.provider_ref, intentId, amount: Number(i.amount), currency: i.currency, phone: i.phone ?? undefined, failureReason: succeed ? undefined : "Declined (simulated)" },
      true,
      { simulated: true },
    );
  },
  { public: true },
);
