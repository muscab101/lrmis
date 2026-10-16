import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { askAssistant, assistantConfigured } from "@/lib/server/assistant";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  question: z.string().trim().min(3).max(500),
  locale: z.enum(["so", "en"]).default("so"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
});

// A small per-user budget so one person can't run up the bill.
const recent = new Map<string, number[]>();
function allowed(user: string) {
  const now = Date.now();
  const list = (recent.get(user) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= 30) return false;
  list.push(now);
  recent.set(user, list);
  return true;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  const { data: ok } = await supabase.rpc("has_permission", { p_key: "reports.view" });
  if (!ok) return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  if (!assistantConfigured()) return NextResponse.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  if (!allowed(auth.user.id)) return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
  try {
    const answer = await askAssistant(supabase, parsed.data.question, parsed.data.locale, parsed.data.history);
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("assistant failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ code: "UNAVAILABLE" }, { status: 502 });
  }
}
