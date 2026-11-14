"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap } from "@/lib/server/action";

const KINDS = [
  "transfer", "certificate_issue", "reprint", "credit_note", "payment_plan",
  "billing_run", "payment_correction", "reversal", "shift", "commission_payout", "commission_rule", "cashier_recon", "recon_batch",
  "pos_payments", "payment", "movement",
] as const;

/** Approve or turn down one item on the Applications page; each kind goes through its own approval step. */
export const decideApprovalAction = defineAction(
  "applications.decide",
  z.object({
    kind: z.enum(KINDS),
    id: z.uuid(),
    approve: z.boolean(),
    note: z.string().trim().max(500).default(""),
    /** Desk payments: cashier, district and days; an appeal: the new total. */
    extra: z.record(z.string(), z.string().max(60)).default({}),
  }),
  async (v, ctx) => {
    const out = unwrap(await ctx.supabase.rpc("approval_decide", { p_kind: v.kind, p_id: v.id, p_approve: v.approve, p_note: v.note || null, p_extra: v.extra }), "decide");
    // The item may show on many pages (land, transfers, certificates, money): all of them read it again.
    revalidatePath("/[locale]", "layout");
    return out;
  },
);
