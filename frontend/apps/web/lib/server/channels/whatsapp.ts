import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelActions, preferredLang, underLimit, type Lang } from "./core";

const EN_WORDS = /^(balance|pay|track|verify|help|menu|hi|hello|english)\b/i;
const SO_WORDS = /^(haraa|hadhaa|bixi|raadi|hubi|caawi|salaan|soomaali|somali)\b/i;

/** Reply to one inbound WhatsApp text. Keywords work in Somali or English; the reply follows. */
export async function whatsappReply(admin: SupabaseClient, phone: string, body: string): Promise<{ text: string; lang: Lang }> {
  const lang = await detectLang(admin, phone, body);
  return { text: await answer(admin, phone, body, lang), lang };
}

async function detectLang(admin: SupabaseClient, phone: string, body: string): Promise<Lang> {
  const text = body.trim();
  if (EN_WORDS.test(text)) return "en";
  if (SO_WORDS.test(text)) return "so";
  return preferredLang(admin, phone);
}

async function answer(admin: SupabaseClient, phone: string, body: string, lang: Lang): Promise<string> {
  const text = body.trim().slice(0, 200);
  const a = channelActions(admin, phone, lang);
  const t = a.t;
  const [word = "", ...rest] = text.split(/\s+/);
  const cmd = word.toLowerCase();
  const arg = rest.join(" ");
  const limited = async (command: string, fn: () => Promise<string>) => ((await underLimit(admin, "whatsapp", phone, command)) ? fn() : t("limit"));

  if (["1", "balance", "haraa", "hadhaa"].includes(cmd)) return limited("balance", () => a.balance());
  if (["2", "pay", "bixi"].includes(cmd)) {
    if (arg) return limited("pay", () => a.payLink(arg));
    const open = await a.openInvoices();
    if (!open.length) return t("nothingToPay");
    return `${t("waPickInvoice")}\n${open
      .slice(0, 5)
      .map((i) => `• ${i.number} — $${Number(i.balance).toFixed(2)} (${i.pun})`)
      .join("\n")}`;
  }
  if (["3", "track", "raadi"].includes(cmd)) return arg ? limited("track", () => a.track(arg)) : t("waAskApp");
  if (["4", "verify", "hubi"].includes(cmd)) return arg ? limited("verify", () => a.verify(arg)) : t("waAskCode");
  return t("waMenu");
}
