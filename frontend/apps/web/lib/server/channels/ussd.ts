import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelActions, preferredLang, underLimit, type Lang } from "./core";

/**
 * Africa's Talking-style USSD: `text` is every answer so far joined by "*".
 * Returns "CON …" to keep the session open or "END …" to close it.
 *   1 balance · 2 pay (pick an invoice → SMS link) · 3 track application · 4 verify certificate · 5 switch language
 */
export async function ussdReply(admin: SupabaseClient, phone: string, text: string): Promise<string> {
  let lang: Lang = await preferredLang(admin, phone);
  const parts = text ? text.split("*").map((s) => s.trim()) : [];
  // "5" toggles the language and shows the menu again; it can come first any number of times.
  while (parts[0] === "5") {
    lang = lang === "so" ? "en" : "so";
    parts.shift();
  }
  const a = channelActions(admin, phone, lang);
  const t = a.t;
  const end = async (command: string, answer: () => Promise<string>) => {
    if (!(await underLimit(admin, "ussd", phone, command))) return `END ${t("limit")}`;
    return `END ${(await answer()).slice(0, 180)}`;
  };

  const [choice, arg] = parts;
  if (!choice) return `CON ${t("menu")}`;
  if (choice === "1") return end("balance", () => a.balance());
  if (choice === "2") {
    const open = await a.openInvoices();
    if (!open.length) return `END ${t("nothingToPay")}`;
    const list = open.slice(0, 5);
    if (!arg) return `CON ${t("pickInvoice")}\n${list.map((i, n) => `${n + 1}. ${i.number} $${Number(i.balance).toFixed(2)}`).join("\n")}`;
    const pick = list[Number(arg) - 1];
    if (!pick) return `END ${t("badChoice")}`;
    return end("pay", () => a.payLink(pick.number));
  }
  if (choice === "3") {
    if (!arg) return `CON ${t("askApp")}`;
    return end("track", () => a.track(arg));
  }
  if (choice === "4") {
    if (!arg) return `CON ${t("askCode")}`;
    return end("verify", () => a.verify(arg));
  }
  return `END ${t("badChoice")}`;
}
