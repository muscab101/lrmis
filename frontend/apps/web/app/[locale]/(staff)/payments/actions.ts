"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { parcelForCashier } from "@/lib/server/payments";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const money = z.coerce.number().positive("validation.amount").max(100_000_000, "validation.amount");

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  for (const p of ["payments", "cashier", "accounting", "invoices"]) revalidatePath(`/[locale]/${p}`, "layout");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return v;
};

// ---- Cashier ----
export const openShiftAction = defineAction("cashier.open", z.object({ posId: z.uuid("validation.required"), float: z.coerce.number().min(0).max(1_000_000) }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("shift_open", { p_pos: v.posId, p_float: v.float }), "open shift") as string),
);

export const findParcelAction = defineAction("cashier.find", z.object({ pun: z.string().trim().min(5, "validation.pun").max(40) }), async ({ pun }) => {
  const out = await parcelForCashier(pun);
  if (!out) throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
  return out;
});

export const takePaymentAction = defineAction(
  "cashier.take",
  z.object({
    shiftId: z.uuid(),
    parcelId: z.uuid(),
    invoiceId: z.uuid().nullable(),
    amount: money,
    currency: z.enum(["USD", "SOS"]),
    method: z.enum(["cash", "cheque", "bank_transfer"]),
    payerName: z.string().max(120).default(""),
    payerPhone: z.string().max(20).default(""),
    reference: z.string().max(80).default(""),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("cashier_take_payment", {
            p_shift: v.shiftId,
            p: {
              parcel_id: v.parcelId,
              invoice_id: v.invoiceId,
              amount: v.amount,
              currency: v.currency,
              method: v.method,
              payer_name: v.payerName,
              payer_phone: v.payerPhone,
              reference: v.reference,
            },
          }),
          "take payment",
        ) as { payment_id: string; receipt_no: string; allocated: number; discount: number; leftover: number },
      );
    } catch (err) {
      field(err, { amount: "amount", no_fx_rate: "currency" });
    }
  },
);

export const closeShiftAction = defineAction(
  "cashier.close",
  z.object({ id: z.uuid(), counted: z.coerce.number().min(0, "validation.amount"), note: z.string().max(500).default("") }),
  async (v, ctx) => {
    try {
      return done(unwrap(await ctx.supabase.rpc("shift_close", { p_id: v.id, p_counted: v.counted, p_note: v.note }), "close shift") as { expected: number; difference: number });
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);

export const approveShiftAction = defineAction("cashier.approve", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  unwrap(await ctx.supabase.rpc("shift_approve", { p_id: id }), "approve shift");
  return done(null);
});

// ---- Payments ----
export const recordBankPaymentAction = defineAction(
  "payments.record_bank",
  z.object({ pun: z.string().trim().max(40).default(""), amount: money, currency: z.enum(["USD", "SOS"]), method: z.enum(["bank_transfer", "cheque"]), reference: z.string().trim().min(2, "validation.reference").max(80), receivedOn: isoDate }),
  async (v, ctx) => {
    let parcelId: string | null = null;
    if (v.pun) {
      const { data } = await ctx.supabase.from("parcels").select("id").eq("pun", v.pun.toUpperCase()).maybeSingle();
      if (!data) throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
      parcelId = (data as { id: string }).id;
    }
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("payment_record_manual", {
            p: { parcel_id: parcelId, amount: v.amount, currency: v.currency, method: v.method, reference: v.reference, provider_ref: `BANK-${v.reference}`, received_at: `${v.receivedOn}T12:00:00Z` },
          }),
          "record bank payment",
        ) as { payment_id: string; receipt_no: string },
      );
    } catch (err) {
      field(err, { no_fx_rate: "currency" });
    }
  },
);

export const matchPaymentAction = defineAction("payments.match", z.object({ id: z.uuid(), pun: z.string().trim().min(5, "validation.pun").max(40) }), async (v, ctx) => {
  const { data } = await ctx.supabase.from("parcels").select("id").eq("pun", v.pun.toUpperCase()).maybeSingle();
  if (!data) throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
  return done(unwrap(await ctx.supabase.rpc("payment_match", { p_id: v.id, p_parcel: (data as { id: string }).id }), "match"));
});

export const applyCreditAction = defineAction("payments.apply_credit", z.object({ id: z.uuid() }), async ({ id }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("payment_apply_credit", { p_id: id }), "apply credit") as { allocated: number }),
);

export const requestReversalAction = defineAction("payments.reverse", z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("reversal_request", { p_payment: v.id, p_reason: v.reason }), "reversal");
  return done(null);
});

export const decideReversalAction = defineAction("payments.decide_reversal", z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("reversal_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "decide reversal");
  } catch (err) {
    field(err, { note_required: "note" });
  }
  return done(null);
});

/** Settlement report as CSV: provider_ref,amount[,date] per line (header optional). */
export const reconcileAction = defineAction(
  "payments.reconcile",
  z.object({ provider: z.string().min(2).max(20), from: isoDate, to: isoDate, csv: z.string().min(3, "validation.csv").max(2_000_000) }),
  async (v, ctx) => {
    const rows = v.csv
      .split(/\r?\n/)
      .map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")))
      .filter((c) => c[0] && !Number.isNaN(Number(c[1])))
      .map((c) => ({ provider_ref: c[0], amount: Number(c[1]), date: /^\d{4}-\d{2}-\d{2}$/.test(c[2] ?? "") ? c[2] : null }));
    if (rows.length === 0) throw new AppFailure("VALIDATION", undefined, { csv: ["validation.csv"] });
    return done(unwrap(await ctx.supabase.rpc("reconciliation_run", { p_provider: v.provider, p_from: v.from, p_to: v.to, p_rows: rows }), "reconcile") as { id: string });
  },
);

export const toggleProviderAction = defineAction("payments.provider", z.object({ code: z.string().min(2).max(20), enabled: z.boolean() }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("payment_provider_set", { p_code: v.code, p_enabled: v.enabled }), "provider");
  return done(null);
});

// ---- Accounting ----
export const setFxRateAction = defineAction("accounting.fx", z.object({ currency: z.enum(["SOS"]), date: isoDate, rate: z.coerce.number().positive("validation.amount") }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("fx_rate_set", { p_currency: v.currency, p_date: v.date, p_rate: v.rate }), "fx");
  return done(null);
});

export const setPeriodAction = defineAction("accounting.period", z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12), lock: z.boolean() }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("period_set", { p_year: v.year, p_month: v.month, p_lock: v.lock }), "period");
  return done(null);
});

export const manualJournalAction = defineAction(
  "accounting.journal",
  z.object({
    date: isoDate,
    memo: z.string().trim().min(3, "validation.memo").max(300),
    lines: z.array(z.object({ account: z.string().regex(/^\d{4}$/), debit: z.coerce.number().min(0), credit: z.coerce.number().min(0) })).min(2, "validation.lines"),
  }),
  async (v, ctx) => {
    try {
      return done(unwrap(await ctx.supabase.rpc("journal_manual", { p_date: v.date, p_memo: v.memo, p_lines: v.lines }), "journal") as string);
    } catch (err) {
      field(err, { unbalanced: "lines", lines: "lines", memo: "memo", period_locked: "date" });
    }
  },
);
