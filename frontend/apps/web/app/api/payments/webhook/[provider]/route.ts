import { NextResponse } from "next/server";
import { log } from "@/lib/server/log";
import { getProvider, ingestEvent } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/webhook/<provider>
 * Verifies the signature over the raw body, then passes the event to webhook_ingest, which stores every
 * event (bad signatures too, for audit) and records a payment at most once per (provider, event id).
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: code } = await params;
  const provider = getProvider(code);
  if (!provider || !provider.configured()) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 256 * 1024) return NextResponse.json({ error: "too large" }, { status: 413 });
  const ok = provider.verifyWebhook(req.headers, raw);
  let event;
  try {
    event = provider.parseWebhook(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!event) return NextResponse.json({ result: "ignored" });
  let rawJson: unknown = {};
  try {
    rawJson = JSON.parse(raw);
  } catch {
    rawJson = { raw };
  }
  try {
    const out = await ingestEvent(code, event, ok, rawJson);
    log(ok ? "info" : "warn", "payments.webhook", { provider: code, eventId: event.eventId, result: out.result });
    // Bad signatures get 401 so the sender notices; everything else 200 so it stops retrying.
    return NextResponse.json({ result: out.result }, { status: ok ? 200 : 401 });
  } catch (err) {
    log("error", "payments.webhook_failed", { provider: code, eventId: event.eventId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
