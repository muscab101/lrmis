import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { providerFor, smsProvider, type OutgoingMessage } from "@/lib/server/messaging";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const BATCH = 50;
const PARALLEL = 5;

function authorised(request: NextRequest) {
  const secret = process.env.MESSAGES_DISPATCH_SECRET;
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sends queued messages. Call it every minute from a scheduler (Vercel Cron, GitHub Actions,
 * or pg_cron + pg_net) with `Authorization: Bearer $MESSAGES_DISPATCH_SECRET`.
 */
async function dispatch(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  if (!smsProvider() && !providerFor("whatsapp")) return NextResponse.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("messages_claim", { p_limit: BATCH });
  if (error) return NextResponse.json({ code: "INTERNAL" }, { status: 500 });
  const batch = (data ?? []) as OutgoingMessage[];
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < batch.length; i += PARALLEL) {
    await Promise.all(
      batch.slice(i, i + PARALLEL).map(async (m) => {
        const provider = providerFor(m.channel);
        const r = provider ? await provider.send(m).catch((e: Error) => ({ ok: false, error: e.message, ref: null })) : { ok: false, error: `channel ${m.channel} not configured`, ref: null };
        if (r.ok) sent++;
        else failed++;
        await admin.rpc("message_result", { p_id: m.id, p_ok: r.ok, p_provider: provider?.code ?? "none", p_ref: r.ref ?? null, p_error: r.ok ? null : (r.error ?? "failed") });
      }),
    );
  }
  return NextResponse.json({ claimed: batch.length, sent, failed });
}

export const POST = dispatch;
export const GET = dispatch;
