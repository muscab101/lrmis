import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Saved assistant conversations. Row-level security keeps each person to their own chats. */

export type Turn = { role: "user" | "assistant"; content: string };
export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

const uuid = /^[0-9a-f-]{36}$/i;

export async function listChats(supabase: SupabaseClient): Promise<ChatSummary[]> {
  const { data } = await supabase.from("assistant_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(100);
  return (data ?? []) as ChatSummary[];
}

/** A chat's messages, oldest first, or null when it isn't the caller's. */
export async function chatMessages(supabase: SupabaseClient, chatId: string): Promise<Turn[] | null> {
  if (!uuid.test(chatId)) return null;
  const { data: chat } = await supabase.from("assistant_chats").select("id").eq("id", chatId).maybeSingle();
  if (!chat) return null;
  const { data } = await supabase.from("assistant_messages").select("role, content").eq("chat_id", chatId).order("id").limit(500);
  return (data ?? []) as Turn[];
}

/** Saves one question and its answer, starting a new chat (titled by the question) when there is none. */
export async function saveTurn(supabase: SupabaseClient, chatId: string | null, question: string, answer: string) {
  let id = chatId;
  if (!id) {
    const title = question.replace(/\s+/g, " ").trim().slice(0, 80);
    const { data, error } = await supabase.from("assistant_chats").insert({ title }).select("id").single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  } else {
    await supabase.from("assistant_chats").update({ updated_at: new Date().toISOString() }).eq("id", id);
  }
  const { error } = await supabase.from("assistant_messages").insert([
    { chat_id: id, role: "user", content: question },
    { chat_id: id, role: "assistant", content: answer.slice(0, 20_000) },
  ]);
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteChat(supabase: SupabaseClient, chatId: string) {
  if (!uuid.test(chatId)) return false;
  const { data } = await supabase.from("assistant_chats").delete().eq("id", chatId).select("id");
  return (data?.length ?? 0) > 0;
}
