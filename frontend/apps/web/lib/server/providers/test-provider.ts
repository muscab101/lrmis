import "server-only";
import { hmacHex, safeEqualHex } from "./crypto";
import type { CheckoutInput, CheckoutResult, PaymentProvider, ProviderEvent } from "./types";

/** Development only: lets the pay page and the webhook path be exercised without a real merchant account. */
export const testProvider: PaymentProvider = {
  code: "test",
  configured: () => process.env.NODE_ENV !== "production" && process.env.PAYMENTS_TEST_MODE === "1" && !!process.env.PAYMENTS_TEST_SECRET,
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return { kind: "pending", providerRef: `TEST-${input.intentId}` };
  },
  verifyWebhook(headers, rawBody) {
    const secret = process.env.PAYMENTS_TEST_SECRET;
    const sig = headers.get("x-test-signature") ?? "";
    return !!secret && /^[0-9a-f]{64}$/i.test(sig) && safeEqualHex(hmacHex(secret, rawBody), sig);
  },
  parseWebhook(rawBody): ProviderEvent | null {
    return JSON.parse(rawBody) as ProviderEvent;
  },
};
