import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, stripeSessionEvent } from "./stripe";
import { testProvider } from "./test-provider";
import type { PaymentProvider, ProviderEvent } from "./types";
import { waafipay } from "./waafipay";

const PROVIDERS: Record<string, PaymentProvider> = { waafipay, stripe, test: testProvider };

export function getProvider(code: string): PaymentProvider | null {
  return PROVIDERS[code] ?? null;
}

/** Online providers a payer can choose: switched on in the database and configured on this server. */
export async function availableOnlineProviders(): Promise<{ code: string; name: string; method: string }[]> {
  const admin = await createAdminClient();
  const { data } = await admin.from("payment_providers").select("code, name, method, enabled, sort").eq("enabled", true).order("sort");
  return ((data ?? []) as { code: string; name: string; method: string }[]).filter((p) => PROVIDERS[p.code]?.configured());
}

/** Hand a verified provider event to the database (idempotent there). */
export async function ingestEvent(provider: string, event: ProviderEvent, signatureOk: boolean, raw: unknown) {
  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("webhook_ingest", {
    p_provider: provider,
    p_event_id: event.eventId,
    p_signature_ok: signatureOk,
    p_event: {
      status: event.status,
      provider_ref: event.providerRef,
      intent_id: event.intentId,
      amount: event.amount,
      currency: event.currency,
      reference: event.reference,
      phone: event.phone,
      failure_reason: event.failureReason,
    },
    p_raw: raw as object,
  });
  if (error) throw new Error(`webhook_ingest: ${error.message}`);
  return data as { result: string; receipt_no?: string; payment_id?: string };
}

/**
 * The payer is back from a hosted checkout (?intent=…): if the intent is still pending, ask the provider
 * and record the payment when it is paid. Safe to repeat: webhook_ingest records one payment per session.
 */
export async function confirmReturnedIntent(intentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) return;
  const admin = await createAdminClient();
  const { data } = await admin.from("payment_intents").select("provider, provider_ref, status").eq("id", intentId).maybeSingle();
  const intent = data as { provider: string; provider_ref: string | null; status: string } | null;
  if (!intent || intent.status !== "pending" || intent.provider !== "stripe" || !intent.provider_ref) return;
  const event = await stripeSessionEvent(intent.provider_ref);
  if (event) await ingestEvent("stripe", event, true, { source: "checkout_return", session: intent.provider_ref });
}

export type { ProviderEvent } from "./types";
