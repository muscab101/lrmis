"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const done = <T>(v: T) => {
  revalidatePath("/[locale]/collections", "page");
  revalidatePath("/[locale]/payments/[id]", "page");
  return v;
};

/** Turn a database detail ("reason", "note_required" …) into a field error the dialog shows under its input. */
function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

export const verifyPaymentsAction = defineAction(
  "collections.verify",
  z.object({ ids: z.array(z.uuid()).min(1).max(500), note: z.string().trim().max(300).default("") }),
  async ({ ids, note }, ctx) => {
    try {
      return done(unwrap(await ctx.supabase.rpc("payment_verify", { p_ids: ids, p_note: note || null }), "verify") as number);
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);

export const disputePaymentAction = defineAction(
  "collections.dispute",
  z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }),
  async ({ id, reason }, ctx) => {
    unwrap(await ctx.supabase.rpc("payment_dispute", { p_id: id, p_reason: reason }), "dispute");
    return done(null);
  },
);

export const requestCorrectionAction = defineAction(
  "collections.correction_request",
  z.object({
    paymentId: z.uuid(),
    how: z.enum(["", "cash", "cheque", "bank_transfer", "evc_plus", "edahab", "zaad"]).default(""),
    reference: z.string().trim().max(80).optional(),
    payerName: z.string().trim().max(120).optional(),
    payerPhone: z.string().trim().max(20).optional(),
    reason: z.string().trim().min(5, "validation.reason").max(500),
  }),
  async (v, ctx) => {
    const changes: Record<string, string> = {};
    if (v.how) {
      const wallet = ["evc_plus", "edahab", "zaad"].includes(v.how);
      changes.method = wallet ? "mobile_money" : v.how;
      if (wallet) changes.wallet = v.how;
    }
    if (v.reference !== undefined) changes.reference = v.reference;
    if (v.payerName !== undefined) changes.payer_name = v.payerName;
    if (v.payerPhone !== undefined) changes.payer_phone = v.payerPhone;
    try {
      return done(unwrap(await ctx.supabase.rpc("payment_correction_request", { p_payment: v.paymentId, p_changes: changes, p_reason: v.reason }), "request correction") as string);
    } catch (err) {
      field(err, { wallet: "how", method: "how", reference_required: "reference", duplicate_reference: "reference", no_change: "how" });
    }
  },
);

export const decideCorrectionAction = defineAction(
  "collections.correction_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().trim().max(500).default("") }),
  async ({ id, approve, note }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("payment_correction_decide", { p_id: id, p_approve: approve, p_note: note || null }), "decide correction");
      return done(null);
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);
