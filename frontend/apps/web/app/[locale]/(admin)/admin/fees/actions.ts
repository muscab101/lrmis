"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

/** Change a fee's amount, or switch it off (settings.update). */
export const setFeeAmountAction = defineAction(
  "fees.set_amount",
  z.object({
    id: z.uuid(),
    amount: z.coerce.number().min(0, "validation.amount").max(100_000_000, "validation.amount"),
    active: z.boolean().default(true),
  }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("fee_set_amount", { p_id: v.id, p_amount: v.amount, p_active: v.active }), "set fee amount");
    } catch (err) {
      if (err instanceof AppFailure && err.code === "VALIDATION") throw new AppFailure("VALIDATION", undefined, { amount: ["validation.amount"] });
      throw err;
    }
    revalidatePath("/[locale]/admin/fees", "page");
    return null;
  },
);
