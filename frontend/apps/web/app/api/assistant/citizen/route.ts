import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { askAssistant, assistantConfigured } from "@/lib/server/assistant";
import { withinBudget } from "@/lib/server/assistant-budget";
import { chatMessages, saveTurn } from "@/lib/server/assistant-chats";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  question: z.string().trim().min(3).max(500),
  locale: z.enum(["so", "en"]).default("so"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(16).default([]),
  /** The saved chat to continue; none starts a new one. */
  chatId: z.string().uuid().nullish(),
});

/** Citizen help assistant: only the signed-in person's own records, through their own session. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("kind, status").eq("user_id", auth.user.id).maybeSingle();
  if (!profile || profile.kind !== "citizen" || profile.status !== "active") return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  if (!assistantConfigured()) return NextResponse.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  if (!withinBudget(auth.user.id, 20)) return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
  const saved = parsed.data.chatId ?? null;
  const history = saved ? await chatMessages(supabase, saved) : parsed.data.history;
  if (!history) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  try {
    const answer = await askAssistant(supabase, parsed.data.question, parsed.data.locale, history.slice(-16), "citizen");
    const chatId = await saveTurn(supabase, saved, parsed.data.question, answer).catch((e: Error) => {
      console.error("assistant chat not saved", e.message);
      return saved;
    });
    return NextResponse.json({ answer, chatId });
  } catch (err) {
    console.error("citizen assistant failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ code: "UNAVAILABLE" }, { status: 502 });
  }
}
