import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { detectWallet } from "@/lib/payments/wallets";
import { stripe } from "@/lib/server/providers/stripe";
import { waafipay } from "@/lib/server/providers/waafipay";

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
const headers = (h: Record<string, string>) => new Headers(h);

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.WAAFIPAY_WEBHOOK_SECRET;
});

describe("Stripe webhook signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", amount_total: 1250, currency: "usd", payment_status: "paid", metadata: { intent_id: "11111111-1111-4111-8111-111111111111" } } } });

  it("accepts a fresh, correctly signed event and rejects tampering, old timestamps and missing secrets", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    const t = Math.floor(Date.now() / 1000);
    const good = hmac("whsec_test_secret", `${t}.${body}`);
    expect(stripe.verifyWebhook(headers({ "stripe-signature": `t=${t},v1=${good}` }), body)).toBe(true);
    expect(stripe.verifyWebhook(headers({ "stripe-signature": `t=${t},v1=${good}` }), body.replace("1250", "1"))).toBe(false);
    const old = t - 3600;
    expect(stripe.verifyWebhook(headers({ "stripe-signature": `t=${old},v1=${hmac("whsec_test_secret", `${old}.${body}`)}` }), body)).toBe(false);
    expect(stripe.verifyWebhook(headers({}), body)).toBe(false);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(stripe.verifyWebhook(headers({ "stripe-signature": `t=${t},v1=${good}` }), body)).toBe(false);
  });

  it("accepts any v1 during secret rotation", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_new";
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${hmac("whsec_old", `${t}.${body}`)},v1=${hmac("whsec_new", `${t}.${body}`)}`;
    expect(stripe.verifyWebhook(headers({ "stripe-signature": sig }), body)).toBe(true);
  });

  it("maps checkout events to payment results in dollars", () => {
    expect(stripe.parseWebhook(body)).toMatchObject({ eventId: "evt_1", status: "succeeded", amount: 12.5, currency: "USD", intentId: "11111111-1111-4111-8111-111111111111" });
    const unpaid = body.replace('"payment_status":"paid"', '"payment_status":"unpaid"');
    expect(stripe.parseWebhook(unpaid)).toBeNull();
    const late = body.replace("checkout.session.completed", "checkout.session.async_payment_succeeded");
    expect(stripe.parseWebhook(late)?.status).toBe("succeeded");
    expect(stripe.parseWebhook(JSON.stringify({ id: "e", type: "customer.created", data: { object: {} } }))).toBeNull();
  });
});

describe("WaafiPay webhook", () => {
  it("verifies the HMAC header and parses EVC Plus / Zaad events", () => {
    process.env.WAAFIPAY_WEBHOOK_SECRET = "waafi_secret";
    const body = JSON.stringify({ transactionId: "T-9", state: "APPROVED", amount: "25.00", currency: "usd", accountNo: "252615550101", description: "BN-HDN-012-000001" });
    expect(waafipay.verifyWebhook(headers({ "x-waafi-signature": hmac("waafi_secret", body) }), body)).toBe(true);
    expect(waafipay.verifyWebhook(headers({ "x-waafi-signature": hmac("other", body) }), body)).toBe(false);
    expect(waafipay.parseWebhook(body)).toMatchObject({ status: "succeeded", amount: 25, currency: "USD", phone: "+252615550101", reference: "BN-HDN-012-000001" });
    expect(waafipay.parseWebhook(body.replace("APPROVED", "DECLINED"))?.status).toBe("failed");
  });
});

describe("mobile-money wallet from the phone number", () => {
  it("recognises EVC Plus, Zaad, Sahal and eDahab", () => {
    expect(detectWallet("+252 61 555 0101")).toBe("evc_plus");
    expect(detectWallet("0771234567")).toBe("evc_plus");
    expect(detectWallet("+252634123456")).toBe("zaad");
    expect(detectWallet("252907123456")).toBe("sahal");
    expect(detectWallet("+252621234567")).toBe("edahab");
    expect(detectWallet("+25261")).toBeNull();
    expect(detectWallet("+254712345678")).toBeNull();
  });
});
