"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap } from "@/lib/server/action";

export interface CardForPrint {
  id: string;
  serial: string;
  holder: string | null;
  pun: string;
  print_count: number;
  status: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  fee_on: boolean;
}

/** A house's ID cards by PUN or card serial, with the state of each one's print bill. */
export const findCardsForPrintAction = defineAction("cashier.card_lookup", z.object({ q: z.string().trim().min(3).max(40) }), async ({ q }, ctx) =>
  unwrap(await ctx.supabase.rpc("card_print_lookup", { p_q: q }), "cards") as CardForPrint[],
);

/** Raise (or reuse) the ID card print bill; it then shows in To collect for cash or card. */
export const billCardPrintAction = defineAction("cashier.card_bill", z.object({ cardId: z.uuid() }), async ({ cardId }, ctx) => {
  const out = unwrap(await ctx.supabase.rpc("card_print_bill", { p_card: cardId }), "card bill") as { invoice_id: string; number: string; existing: boolean };
  revalidatePath("/[locale]/cashier", "page");
  return out;
});
