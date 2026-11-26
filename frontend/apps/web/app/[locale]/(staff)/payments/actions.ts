"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { EVIDENCE_BUCKET } from "@/lib/server/collections";
import { log } from "@/lib/server/log";
import { parcelForCashier } from "@/lib/server/payments";
import { getProvider, ingestEvent } from "@/lib/server/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePun, punFilter } from "@/lib/pun";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const money = z.coerce.number().positive("validation.amount").max(100_000_000, "validation.amount");

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail])
    throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  for (const p of ["payments", "cashier", "accounting", "invoices"])
    revalidatePath(`/[locale]/${p}`, "layout");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return v;
};

// ---- Cashier ----
export const openShiftAction = defineAction(
  "cashier.open",
  z.object({
    posId: z.uuid("validation.required"),
  }),
  // No starting cash: a shift starts empty.
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("shift_open", { p_pos: v.posId, p_float: 0 }),
        "open shift",
      ) as string,
    ),
);

export const findParcelAction = defineAction(
  "cashier.find",
  z.object({ pun: z.string().trim().min(5, "validation.pun").max(40) }),
  async ({ pun }) => {
    // PUN, invoice number or application number.
    const out = await parcelForCashier(pun);
    if (!out) throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
    return out;
  },
);

export const takePaymentAction = defineAction(
  "cashier.take",
  z.object({
    shiftId: z.uuid(),
    parcelId: z.uuid(),
    invoiceId: z.uuid().nullable(),
    amount: money,
    currency: z.enum(["USD", "SOS"]),
    method: z.enum(["cash", "cheque", "bank_transfer", "mobile_money"]),
    wallet: z.enum(["evc_plus", "edahab", "zaad"]).nullable().default(null),
    payerName: z.string().max(120).default(""),
    payerPhone: z.string().max(20).default(""),
    reference: z.string().trim().max(80).default(""),
    /** The same amount was just taken for this parcel; the cashier confirmed it is a second payment. */
    confirmDuplicate: z.boolean().default(false),
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
              wallet: v.method === "mobile_money" ? v.wallet : null,
              payer_name: v.payerName,
              payer_phone: v.payerPhone,
              reference: v.reference,
              confirm_duplicate: v.confirmDuplicate,
            },
          }),
          "take payment",
        ) as {
          payment_id: string;
          receipt_no: string;
          allocated: number;
          discount: number;
          leftover: number;
        },
      );
    } catch (err) {
      field(err, {
        amount: "amount",
        no_fx_rate: "currency",
        wallet: "wallet",
        reference_required: "reference",
        duplicate_reference: "reference",
      });
    }
  },
);

export const closeShiftAction = defineAction(
  "cashier.close",
  z.object({
    id: z.uuid(),
  }),
  // No counting: the database records the cash as exactly what was taken.
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("shift_close", { p_id: v.id, p_counted: null as unknown as number, p_note: "" }),
        "close shift",
      ) as { expected: number; difference: number },
    ),
);

// ---- Payments ----
export const recordBankPaymentAction = defineAction(
  "payments.record_bank",
  z.object({
    pun: z.string().trim().max(40).default(""),
    amount: money,
    currency: z.enum(["USD", "SOS"]),
    method: z.enum(["bank_transfer", "cheque"]),
    reference: z.string().trim().min(2, "validation.reference").max(80),
    receivedOn: isoDate,
  }),
  async (v, ctx) => {
    let parcelId: string | null = null;
    if (v.pun) {
      const { data } = await ctx.supabase
        .from("parcels")
        .select("id")
        .or(punFilter(normalizePun(v.pun)))
        .maybeSingle();
      if (!data)
        throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
      parcelId = (data as { id: string }).id;
    }
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("payment_record_manual", {
            p: {
              parcel_id: parcelId,
              amount: v.amount,
              currency: v.currency,
              method: v.method,
              reference: v.reference,
              provider_ref: `BANK-${v.reference}`,
              received_at: `${v.receivedOn}T12:00:00Z`,
            },
          }),
          "record bank payment",
        ) as { payment_id: string; receipt_no: string },
      );
    } catch (err) {
      field(err, { no_fx_rate: "currency" });
    }
  },
);

export const matchPaymentAction = defineAction(
  "payments.match",
  z.object({ id: z.uuid(), pun: z.string().trim().min(5, "validation.pun").max(40) }),
  async (v, ctx) => {
    const { data } = await ctx.supabase
      .from("parcels")
      .select("id")
      .or(punFilter(normalizePun(v.pun)))
      .maybeSingle();
    if (!data) throw new AppFailure("NOT_FOUND", undefined, { pun: ["validation.pun_not_found"] });
    return done(
      unwrap(
        await ctx.supabase.rpc("payment_match", {
          p_id: v.id,
          p_parcel: (data as { id: string }).id,
        }),
        "match",
      ),
    );
  },
);

export const applyCreditAction = defineAction(
  "payments.apply_credit",
  z.object({ id: z.uuid() }),
  async ({ id }, ctx) =>
    done(
      unwrap(await ctx.supabase.rpc("payment_apply_credit", { p_id: id }), "apply credit") as {
        allocated: number;
      },
    ),
);

export const requestReversalAction = defineAction(
  "payments.reverse",
  z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("reversal_request", { p_payment: v.id, p_reason: v.reason }),
      "reversal",
    );
    return done(null);
  },
);

/** Settlement report as CSV: provider_ref,amount[,date] per line (header optional). */
export const toggleProviderAction = defineAction(
  "payments.provider",
  z.object({ code: z.string().min(2).max(20), enabled: z.boolean() }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("payment_provider_set", { p_code: v.code, p_enabled: v.enabled }),
      "provider",
    );
    return done(null);
  },
);

/** The bank account citizens transfer to (shown on the pay page). */
export const bankAccountSetAction = defineAction(
  "payments.bank_account",
  z.object({
    bank: z.string().trim().max(80),
    account_name: z.string().trim().max(120),
    account_no: z.string().trim().max(60),
    branch: z.string().trim().max(80),
    swift: z.string().trim().max(20),
  }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("payment_bank_account_set", { p: v }), "bank account");
    revalidatePath("/[locale]/pay/[token]", "page");
    return done(null);
  },
);

// ---- Accounting ----
export const setFxRateAction = defineAction(
  "accounting.fx",
  z.object({
    currency: z.enum(["SOS"]),
    date: isoDate,
    rate: z.coerce.number().positive("validation.amount"),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("fx_rate_set", {
        p_currency: v.currency,
        p_date: v.date,
        p_rate: v.rate,
      }),
      "fx",
    );
    return done(null);
  },
);

export const setPeriodAction = defineAction(
  "accounting.period",
  z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    lock: z.boolean(),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("period_set", { p_year: v.year, p_month: v.month, p_lock: v.lock }),
      "period",
    );
    return done(null);
  },
);

export const manualJournalAction = defineAction(
  "accounting.journal",
  z.object({
    date: isoDate,
    memo: z.string().trim().min(3, "validation.memo").max(300),
    lines: z
      .array(
        z.object({
          account: z.string().regex(/^\d{4}$/),
          debit: z.coerce.number().min(0),
          credit: z.coerce.number().min(0),
        }),
      )
      .min(2, "validation.lines"),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("journal_manual", {
            p_date: v.date,
            p_memo: v.memo,
            p_lines: v.lines,
          }),
          "journal",
        ) as string,
      );
    } catch (err) {
      field(err, { unbalanced: "lines", lines: "lines", memo: "memo", period_locked: "date" });
    }
  },
);

// ---- Evidence ----
const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Keep a receipt photo, statement page or SMS screenshot with a payment. */
export async function uploadEvidenceAction(form: FormData) {
  const handler = defineAction(
    "payments.evidence",
    z.object({ paymentId: z.uuid(), note: z.string().trim().max(300).default("") }),
    async ({ paymentId, note }, ctx) => {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0)
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
      if (file.size > 10 * 1024 * 1024)
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.file_too_big"] });
      if (!EVIDENCE_TYPES.includes(file.type))
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.evidence_type"] });
      const path = `${paymentId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
      const admin = await createAdminClient();
      const up = await admin.storage
        .from(EVIDENCE_BUCKET)
        .upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(`evidence upload: ${up.error.message}`);
      const res = await ctx.supabase.rpc("payment_add_evidence", {
        p_payment: paymentId,
        p_path: path,
        p_name: file.name,
        p_type: file.type,
        p_note: note,
      });
      if (res.error) {
        const rm = await admin.storage.from(EVIDENCE_BUCKET).remove([path]);
        if (rm.error)
          log("error", "payments.evidence_cleanup_failed", { requestId: ctx.requestId, path });
        unwrap(res, "add evidence");
      }
      revalidatePath("/[locale]/payments/[id]", "page");
      return null;
    },
  );
  return handler({
    paymentId: String(form.get("paymentId") ?? ""),
    note: String(form.get("note") ?? ""),
  });
}

/**
 * Cashier: a push payment, just in case — the bill's amount is requested on the payer's phone (EVC Plus, ZAAD, eDahab
 * through the mobile money provider) and they approve it with their PIN. The payment is recorded when the provider
 * confirms, exactly like a payment the owner starts online; the desk itself records nothing.
 */
export const pushPaymentAction = defineAction(
  "cashier.push_payment",
  z.object({
    invoiceId: z.uuid(),
    provider: z.string().min(2).max(20),
    // Spaces, brackets and dashes are allowed while typing; they're taken out below.
    phone: z.string().trim().regex(/^\+?[\s()-]*2[\s()-]*5[\s()-]*2(?:[\s()-]*[0-9]){8,9}[\s()-]*$/, "validation.phone_so"),
  }),
  async (input, ctx) => {
    const v = { ...input, phone: input.phone.replace(/[\s()-]/g, "") };
    const provider = getProvider(v.provider);
    if (!provider || !provider.configured()) throw new AppFailure("VALIDATION", undefined, { provider: ["validation.provider"] });
    let intent: { intent_id: string; amount: number; currency: string; invoice_number: string; pun: string | null };
    try {
      intent = unwrap(
        await ctx.supabase.rpc("payment_intent_create", { p_invoice: v.invoiceId, p_token: null, p_provider: v.provider, p_phone: v.phone }),
        "push payment",
      ) as typeof intent;
    } catch (err) {
      field(err, { phone: "phone" });
    }
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const result = await provider.createCheckout({
      intentId: intent.intent_id,
      invoiceNumber: intent.invoice_number,
      pun: intent.pun,
      amount: Number(intent.amount),
      currency: intent.currency,
      phone: v.phone,
      returnUrl: `${site}/en/cashier`,
    });
    const admin = await createAdminClient();
    await admin.rpc("payment_intent_set_checkout", { p_id: intent.intent_id, p_provider_ref: result.providerRef, p_checkout_url: "" });
    if (result.kind === "completed") {
      const out = await ingestEvent(v.provider, result.event, true, { source: "api", event: result.event });
      log("info", "cashier.push_completed", { requestId: ctx.requestId, provider: v.provider, result: out.result });
    }
    return done({ intentId: intent.intent_id, amount: Number(intent.amount), invoiceNumber: intent.invoice_number });
  },
);

/** Whether a push payment was approved on the phone yet (the cashier's window waits on this). */
export const pushPaymentStatusAction = defineAction(
  "cashier.push_status",
  z.object({ intentId: z.uuid() }),
  async ({ intentId }, ctx) =>
    unwrap(await ctx.supabase.rpc("payment_intent_status", { p_id: intentId }), "status") as {
      status: string;
      receipt_no: string | null;
      failure_reason: string | null;
    } | null,
);
