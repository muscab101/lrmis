import { NextResponse } from "next/server";
import { listChats } from "@/lib/server/assistant-chats";
import { createClient } from "@/lib/supabase/server";

/** The signed-in person's saved assistant chats, newest first. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({ chats: await listChats(supabase) });
}
