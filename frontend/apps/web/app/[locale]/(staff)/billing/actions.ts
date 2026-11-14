"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const money = z.coerce.number().min(0, "validation.amount").max(10_000_000, "validation.amount");

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  revalidatePath("/[locale]/billing", "layout");
  revalidatePath("/[locale]/invoices", "layout");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return v;
};

const runStep = (name: string, rpc: string) =>
  defineAction(`billing.${name}`, z.object({ id: z.uuid() }), async ({ id }, ctx) => done(unwrap(await ctx.supabase.rpc(rpc, { p_id: id }), name)));

export const refreshRunAction = runStep("refresh_run", "billing_run_refresh");
export const submitRunAction = runStep("submit_run", "billing_run_submit");
export const approveRunAction = runStep("approve_run", "billing_run_approve");
export const generateRunAction = runStep("generate_run", "billing_run_generate");
/** Issue the bills now, without the approval step. */
export const issueNowRunAction = runStep("issue_now_run", "billing_run_issue_now");

export const cancelRunAction = defineAction("billing.cancel_run", z.object({ id: z.uuid(), reason: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("billing_run_cancel", { p_id: v.id, p_reason: v.reason }), "cancel run");
  } catch (err) {
    field(err, { note_required: "reason" });
  }
  return done(null);
});

export const createInvoiceAction = defineAction(
  "invoices.create",
  z.object({ parcelId: z.uuid(), feeTypeId: z.uuid("validation.required"), amount: money.nullable(), note: z.string().max(300).default("") }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(await ctx.supabase.rpc("invoice_create", { p_parcel: v.parcelId, p_fee_type: v.feeTypeId, p_amount: v.amount, p_note: v.note }), "create invoice") as {
          id: string;
          number: string;
        },
      );
    } catch (err) {
      field(err, { amount: "amount", fee_type: "feeTypeId" });
    }
  },
);

export const cancelInvoiceAction = defineAction("invoices.cancel", z.object({ id: z.uuid(), reason: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("invoice_cancel", { p_id: v.id, p_reason: v.reason }), "cancel invoice");
  } catch (err) {
    field(err, { note_required: "reason" });
  }
  return done(null);
});

/** Change one bill's amount, with a reason (kept on the bill). Never below what's already paid. */
export const editInvoiceAmountAction = defineAction(
  "invoices.update",
  z.object({ id: z.uuid(), total: z.coerce.number().positive("validation.amount").max(100_000_000, "validation.amount"), reason: z.string().trim().min(5, "validation.reason").max(500) }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("invoice_set_total", { p_id: v.id, p_total: v.total, p_reason: v.reason }), "change invoice amount");
    } catch (err) {
      field(err, { amount: "total", reason: "reason", rebill_below_paid: "total" });
    }
    return done(null);
  },
);

export interface DuplicateCopy {
  id: string;
  number: string;
  total: number;
  paid: number;
  pun: string | null;
  parcel_id: string;
  fee_so: string;
  fee_en: string;
  keep: boolean;
  has_money: boolean;
}

export interface MissingBill {
  parcel_id: string;
  pun: string | null;
  house_no: string | null;
  neighbourhood_code?: string | null;
  owners: string | null;
  code: string;
  fee_so: string;
  fee_en: string;
  amount: number;
}

export const checkDuplicatesAction = defineAction("invoices.check_duplicates", z.object({}), async (_v, ctx) =>
  unwrap(await ctx.supabase.rpc("invoice_duplicates", {}), "check duplicates") as DuplicateCopy[],
);

/** One of each stays; the others are cancelled, so they stay on record. */
export const fixDuplicatesAction = defineAction("invoices.fix_duplicates", z.object({}), async (_v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("invoice_duplicates_fix", {}), "fix duplicates") as { cancelled: number; left: number }),
);

export const checkMissingAction = defineAction("invoices.check_missing", z.object({}), async (_v, ctx) =>
  unwrap(await ctx.supabase.rpc("invoice_missing", {}), "check missing") as MissingBill[],
);

export const createMissingAction = defineAction("invoices.create_missing", z.object({ parcelIds: z.array(z.uuid()).min(1).max(1000) }), async ({ parcelIds }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("invoice_missing_create", { p_parcels: parcelIds }), "create missing") as number),
);

/** Print an invoice now: straight to the added printer at this person's own point of sale (no page opens). */
export const invoicePrintNowAction = defineAction(
  "invoices.print_now",
  z.object({ id: z.uuid(), locale: z.enum(["so", "en"]) }),
  async (v, ctx) =>
    unwrap(await ctx.supabase.rpc("invoice_print_now", { p_id: v.id, p_locale: v.locale }), "print invoice") as {
      job: string;
      printer: string;
      online: boolean;
    },
);
