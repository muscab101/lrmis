import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import so from "@/messages/so.json";

export type Lang = "so" | "en";
type Balance = { pun: string; balance: number; invoices: { number: string; balance: number; due_date: string }[] }[];

type Translate = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

/** Channel texts from the same message files as the web app (no request locale here). */
export function translator(lang: Lang): Translate {
  return createTranslator({ locale: lang, messages: lang === "en" ? en : so, namespace: "channels" }) as unknown as Translate;
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;

/** E.164 for Somali and other numbers: "25261…" / "061…" / "+25261…" → "+25261…". */
export function normalisePhone(raw: string): string | null {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  else if (p.startsWith("0")) p = `+252${p.slice(1)}`;
  else if (!p.startsWith("+")) p = `+${p}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/** The answers both channels give. All lookups are scoped to the caller's own phone in the database. */
export function channelActions(admin: SupabaseClient, phone: string, lang: Lang) {
  const t = translator(lang);
  return {
    t,
    async balance() {
      const { data } = await admin.rpc("channel_balance", { p_phone: phone });
      const rows = (data ?? []) as Balance;
      if (!rows.length) return t("noParcels");
      const lines = rows.slice(0, 4).map((r) => `${r.pun}: ${Number(r.balance) > 0 ? money(r.balance) : t("nothingDue")}`);
      return [t("balanceTitle"), ...lines, rows.length > 4 ? t("more", { n: rows.length - 4 }) : ""].filter(Boolean).join("\n");
    },
    async openInvoices() {
      const { data } = await admin.rpc("channel_balance", { p_phone: phone });
      return ((data ?? []) as Balance).flatMap((r) => r.invoices.map((i) => ({ ...i, pun: r.pun })));
    },
    async payLink(invoice: string) {
      const { data } = await admin.rpc("channel_send_pay_link", { p_phone: phone, p_invoice: invoice, p_lang: lang });
      return data ? t("payLinkSent", { invoice: (data as { number: string }).number }) : t("invoiceNotFound");
    },
    async track(number: string) {
      const { data } = await admin.rpc("channel_track", { p_phone: phone, p_number: number });
      if (!data) return t("appNotFound");
      const a = data as { number: string; status: string };
      return t("appStatus", { number: a.number, status: t.has(`status.${a.status}`) ? t(`status.${a.status}`) : a.status });
    },
    async verify(code: string) {
      const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (clean.length !== 12) return t("codeInvalid");
      const { data } = await admin.rpc("verify_document", { p_code: clean });
      if (!data) return t("docNotFound");
      const d = data as { status: string; serial: string; pun?: string; owners?: string[] };
      return t("docStatus", { serial: d.serial, status: t(`docStatuses.${d.status}`), pun: d.pun ?? "—", owners: (d.owners ?? []).join(", ") || "—" });
    },
  };
}

export async function underLimit(admin: SupabaseClient, channel: "ussd" | "whatsapp", phone: string, command: string) {
  const { data } = await admin.rpc("channel_hit", { p_channel: channel, p_phone: phone, p_command: command });
  return data !== false;
}

export async function preferredLang(admin: SupabaseClient, phone: string): Promise<Lang> {
  const { data } = await admin.rpc("channel_preferred_lang", { p_phone: phone });
  return data === "en" ? "en" : "so";
}
