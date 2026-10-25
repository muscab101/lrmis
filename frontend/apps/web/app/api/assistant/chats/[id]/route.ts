import { NextResponse, type NextRequest } from "next/server";
import { chatMessages, deleteChat } from "@/lib/server/assistant-chats";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

async function signedIn() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user ? supabase : null;
}

/** One saved chat's messages. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  const messages = await chatMessages(supabase, (await params).id);
  return messages ? NextResponse.json({ messages }) : NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  return (await deleteChat(supabase, (await params).id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
}
