import "server-only";

export interface OutgoingMessage {
  id: string;
  channel: "sms" | "whatsapp" | "email";
  to_address: string;
  body: string;
  template_code: string | null;
}

export interface SendResult {
  ok: boolean;
  ref?: string | null;
  error?: string;
}

export interface MessageProvider {
  code: string;
  send(m: OutgoingMessage): Promise<SendResult>;
}

const mask = (phone: string) => phone.replace(/^(\+\d{3})\d+(\d{3})$/, "$1•••$2");

/** Development: prints a masked line and marks the message sent. Never used in production. */
const logProvider: MessageProvider = {
  code: "log",
  async send(m) {
    console.info(`[sms:log] ${m.template_code ?? "message"} → ${mask(m.to_address)} (${m.body.length} chars)`);
    return { ok: true, ref: `log-${m.id.slice(0, 8)}` };
  },
};

/** Twilio Programmable Messaging (works for Somali numbers; swap for a local gateway when contracted). */
const twilioProvider: MessageProvider = {
  code: "twilio",
  async send(m) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return { ok: false, error: "twilio not configured" };
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: m.to_address, From: from, Body: m.body }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: Error) => ({ ok: false, status: 0, json: async () => ({ message: err.message }) }) as const);
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    return res.ok && data.sid ? { ok: true, ref: data.sid } : { ok: false, error: `${res.status} ${data.code ?? ""} ${data.message ?? ""}`.trim() };
  },
};

/** WhatsApp Cloud API: free-form text inside the 24-hour window after the person writes to us. */
const whatsappProvider: MessageProvider = {
  code: "whatsapp",
  async send(m) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false, error: "whatsapp not configured" };
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: m.to_address.replace(/^\+/, ""), type: "text", text: { body: m.body, preview_url: true } }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: Error) => ({ ok: false, status: 0, json: async () => ({ error: { message: err.message } }) }) as const);
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    return res.ok && data.messages?.[0]?.id ? { ok: true, ref: data.messages[0].id } : { ok: false, error: `${res.status} ${data.error?.code ?? ""} ${data.error?.message ?? ""}`.trim() };
  },
};

/** Provider for a message's channel, or null when that channel is switched off. */
export function providerFor(channel: OutgoingMessage["channel"]): MessageProvider | null {
  if (channel === "sms") return smsProvider();
  if (channel === "whatsapp") return process.env.WHATSAPP_TOKEN ? whatsappProvider : process.env.NODE_ENV !== "production" ? logProvider : null;
  return null;
}

/** The configured SMS provider, or null when sending is switched off. */
export function smsProvider(): MessageProvider | null {
  const code = process.env.SMS_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "log");
  if (code === "twilio") return twilioProvider;
  if (code === "log" && process.env.NODE_ENV !== "production") return logProvider;
  return null;
}
