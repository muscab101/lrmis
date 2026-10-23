/** What the database needs to know about a provider event (see public.webhook_ingest). */
export interface ProviderEvent {
  eventId: string;
  status: "succeeded" | "failed";
  providerRef?: string;
  intentId?: string;
  amount: number;
  currency: string;
  reference?: string;
  phone?: string;
  failureReason?: string;
}

export interface CheckoutInput {
  intentId: string;
  invoiceNumber: string;
  /** Null while the land has no PUN yet. */
  pun: string | null;
  amount: number;
  currency: string;
  phone?: string;
  returnUrl: string;
}

/**
 * - redirect: send the payer to a hosted page (cards).
 * - completed: the provider answered synchronously (mobile money push): the event is final.
 * - pending: wait for the webhook.
 */
export type CheckoutResult =
  | { kind: "redirect"; providerRef: string; url: string }
  | { kind: "completed"; providerRef: string; event: ProviderEvent }
  | { kind: "pending"; providerRef: string };

export interface PaymentProvider {
  code: string;
  /** Configured on this server (keys present). */
  configured(): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Check the request really comes from the provider (signature over the raw body). */
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  /** Turn a verified body into an event; null for event types we ignore. */
  parseWebhook(rawBody: string): ProviderEvent | null;
}
