import { NextResponse, type NextRequest } from "next/server";
import { normalisePhone } from "@/lib/server/channels/core";
import { whatsappReply } from "@/lib/server/channels/whatsapp";
import { hmacHex, safeEqualHex } from "@/lib/server/providers/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Meta's one-time subscription check. */
export function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
}

type Inbound = { entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[] };

/** Inbound messages (WhatsApp Cloud API), signed with the app secret. Replies go through the outbox. */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const raw = await request.text();
  const sig = (request.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!secret || !safeEqualHex(sig, hmacHex(secret, raw))) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  let payload: Inbound;
  try {
    payload = JSON.parse(raw) as Inbound;
  } catch {
    return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  }
  const admin = await createAdminClient();
  const inbound = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  for (const m of inbound.slice(0, 20)) {
    const phone = normalisePhone(m.from ?? "");
    if (!phone || m.type !== "text" || !m.text?.body) continue;
    try {
      const reply = await whatsappReply(admin, phone, m.text.body);
      await admin.rpc("channel_reply_whatsapp", { p_phone: phone, p_text: reply.text, p_lang: reply.lang });
    } catch (err) {
      console.error("whatsapp reply failed", err instanceof Error ? err.message : err);
    }
  }
  // Always 200 once the signature is good, so Meta doesn't retry.
  return NextResponse.json({ ok: true });
}
