import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { normalisePhone } from "@/lib/server/channels/core";
import { ussdReply } from "@/lib/server/channels/ussd";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const plain = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The USSD gateway callback URL is configured with ?key=$USSD_CALLBACK_KEY (gateways don't sign requests). */
function authorised(request: NextRequest) {
  const secret = process.env.USSD_CALLBACK_KEY;
  const got = request.nextUrl.searchParams.get("key") ?? "";
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return plain("END Unauthorised", 401);
  const form = await request.formData().catch(() => null);
  const phone = normalisePhone(String(form?.get("phoneNumber") ?? ""));
  const text = String(form?.get("text") ?? "").slice(0, 200);
  if (!phone) return plain("END Invalid phone number");
  try {
    return plain(await ussdReply(await createAdminClient(), phone, text));
  } catch (err) {
    console.error("ussd failed", err instanceof Error ? err.message : err);
    return plain("END Adeeggu hadda ma shaqaynayo. Service unavailable.");
  }
}
