"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const done = <T>(v: T) => {
  revalidatePath("/[locale]/collections", "layout");
  revalidatePath("/[locale]/payments/[id]", "page");
  return v;
};

/** Turn a database detail ("reason", "note_required" …) into a field error the dialog shows under its input. */
function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail])
    throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

export const verifyPaymentsAction = defineAction(
  "collections.verify",
  z.object({
    ids: z.array(z.uuid()).min(1).max(500),
    note: z.string().trim().max(300).default(""),
  }),
  async ({ ids, note }, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("payment_verify", { p_ids: ids, p_note: note || null }),
          "verify",
        ) as number,
      );
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
      return done(
        unwrap(
          await ctx.supabase.rpc("payment_correction_request", {
            p_payment: v.paymentId,
            p_changes: changes,
            p_reason: v.reason,
          }),
          "request correction",
        ) as string,
      );
    } catch (err) {
      field(err, {
        wallet: "how",
        method: "how",
        reference_required: "reference",
        duplicate_reference: "reference",
        no_change: "how",
      });
    }
  },
);

export const decideCorrectionAction = defineAction(
  "collections.correction_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().trim().max(500).default("") }),
  async ({ id, approve, note }, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("payment_correction_decide", {
          p_id: id,
          p_approve: approve,
          p_note: note || null,
        }),
        "decide correction",
      );
      return done(null);
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);

const channelAmounts = z.partialRecord(
  z.enum(["cash", "evc_plus", "edahab", "zaad", "bank_transfer", "card", "other"]),
  z.coerce.number().min(0, "validation.amount").max(100_000_000),
);

export const submitReconAction = defineAction(
  "collections.recon_submit",
  z.object({
    cashierId: z.uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    actual: channelAmounts,
    note: z.string().trim().max(1000).default(""),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("cashier_recon_submit", {
            p_cashier: v.cashierId,
            p_date: v.date,
            p_actual: v.actual,
            p_note: v.note || null,
          }),
          "reconcile",
        ) as string,
      );
    } catch (err) {
      field(err, { note_required: "note", actual_missing: "actual" });
    }
  },
);

export const decideReconAction = defineAction(
  "collections.recon_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().trim().max(1000).default("") }),
  async ({ id, approve, note }, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("cashier_recon_decide", {
          p_id: id,
          p_approve: approve,
          p_note: note || null,
        }),
        "decide reconciliation",
      );
      return done(null);
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);

// ---- Statement reconciliation ----
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
type StatementRow = { provider_ref: string; amount: number; date: string | null };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return String(o.text);
  }
  return String(v).trim();
};
const toAmount = (s: string) => Number(s.replace(/[^\d.-]/g, ""));
const toDay = (s: string) => {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
};

/** Reference, amount and date columns: found by their headings, else the first three columns. */
function statementRows(table: string[][]): StatementRow[] {
  const find = (row: string[], re: RegExp) => row.findIndex((c) => re.test(c));
  const headIdx = table
    .slice(0, 10)
    .findIndex(
      (r) =>
        find(r, /ref|transaction|txn|trans\.? ?id|receipt/i) >= 0 &&
        find(r, /amount|amt|credit|lacag/i) >= 0,
    );
  let ref = 0;
  let amt = 1;
  let day = 2;
  let start = 0;
  if (headIdx >= 0) {
    const h = table[headIdx]!;
    ref = find(h, /ref|transaction|txn|trans\.? ?id|receipt/i);
    amt = find(h, /amount|amt|credit|lacag/i);
    day = find(h, /date|time|taariikh/i);
    start = headIdx + 1;
  }
  return table
    .slice(start)
    .map((r) => ({
      provider_ref: (r[ref] ?? "").trim(),
      amount: toAmount(r[amt] ?? ""),
      date: day >= 0 ? toDay(r[day] ?? "") : null,
    }))
    .filter((r) => r.provider_ref && Number.isFinite(r.amount) && r.amount !== 0)
    .map((r) => ({ ...r, amount: Math.abs(r.amount) }));
}

/** Upload a wallet or bank statement (CSV or Excel) and compare it with the payments recorded for those dates. */
export async function uploadStatementAction(form: FormData) {
  const handler = defineAction(
    "collections.statement_upload",
    z.object({
      provider: z.string().min(2).max(20),
      from: isoDay,
      to: isoDay,
      text: z.string().max(2_000_000).default(""),
    }),
    async (v, ctx) => {
      const file = form.get("file");
      let table: string[][] = [];
      if (file instanceof File && file.size > 0) {
        if (file.size > 10 * 1024 * 1024)
          throw new AppFailure("VALIDATION", undefined, { file: ["validation.file_too_big"] });
        if (/\.xlsx$/i.test(file.name)) {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(await file.arrayBuffer());
          const ws = wb.worksheets[0];
          ws?.eachRow({ includeEmpty: false }, (row) => {
            const vals = row.values as unknown[];
            table.push(vals.slice(1).map(cellText));
          });
        } else if (/\.(csv|txt)$/i.test(file.name)) {
          table = (await file.text())
            .split(/\r?\n/)
            .map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
        } else {
          throw new AppFailure("VALIDATION", undefined, { file: ["validation.statement_type"] });
        }
      } else {
        table = v.text
          .split(/\r?\n/)
          .map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
      }
      const rows = statementRows(table);
      if (rows.length === 0)
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.csv"] });
      if (v.to < v.from) throw new AppFailure("VALIDATION", undefined, { to: ["validation.date"] });
      return done(
        unwrap(
          await ctx.supabase.rpc("reconciliation_run", {
            p_provider: v.provider,
            p_from: v.from,
            p_to: v.to,
            p_rows: rows,
          }),
          "statement",
        ) as { id: string },
      );
    },
  );
  return handler({
    provider: String(form.get("provider") ?? ""),
    from: String(form.get("from") ?? ""),
    to: String(form.get("to") ?? ""),
    text: String(form.get("text") ?? ""),
  });
}

export const statementCandidatesAction = defineAction(
  "collections.statement_candidates",
  z.object({ line: z.coerce.number().int().positive(), q: z.string().trim().max(60).default("") }),
  async (v, ctx) => {
    const { data, error } = await ctx.supabase.rpc("recon_candidates", {
      p_line: v.line,
      p_q: v.q || null,
    });
    if (error) unwrap({ data, error }, "candidates");
    return (data ?? []) as {
      payment_id: string;
      receipt_no: string;
      reference: string | null;
      amount: number;
      received_at: string;
      payer_name: string | null;
    }[];
  },
);

const note = z
  .string()
  .trim()
  .min(3, "validation.note_required")
  .max(1000, "validation.reason_long");

export const matchLineAction = defineAction(
  "collections.statement_match",
  z.object({
    line: z.coerce.number().int().positive(),
    paymentId: z.uuid("validation.required"),
    note,
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("recon_line_match", {
        p_line: v.line,
        p_payment: v.paymentId,
        p_note: v.note,
      }),
      "match line",
    );
    return done(null);
  },
);

export const resolveLineAction = defineAction(
  "collections.statement_resolve",
  z.object({ line: z.coerce.number().int().positive(), note }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("recon_line_resolve", { p_line: v.line, p_note: v.note }),
      "resolve line",
    );
    return done(null);
  },
);

export const submitBatchAction = defineAction(
  "collections.statement_submit",
  z.object({ id: z.uuid(), note: z.string().trim().max(1000).default("") }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("recon_batch_submit", { p_batch: v.id, p_note: v.note || null }),
      "submit batch",
    );
    return done(null);
  },
);

export const decideBatchAction = defineAction(
  "collections.statement_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().trim().max(1000).default("") }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("recon_batch_decide", {
          p_batch: v.id,
          p_approve: v.approve,
          p_note: v.note || null,
        }),
        "decide batch",
      );
      return done(null);
    } catch (err) {
      field(err, { note_required: "note" });
    }
  },
);

export const deleteBatchAction = defineAction(
  "collections.statement_delete",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("recon_batch_delete", { p_batch: v.id }), "delete batch");
    return done(null);
  },
);

/** Approve every waiting payment one cashier took at one point of sale in the period (never your own takings). */
export const approvePosCashierAction = defineAction(
  "collections.pos_approve",
  z.object({ pos: z.uuid(), cashier: z.uuid(), from: z.iso.date(), to: z.iso.date(), district: z.uuid().nullable().default(null) }),
  // For online payments shown under a district office, only that district's (district).
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("pos_cashier_approve", { p_pos: v.pos, p_cashier: v.cashier, p_from: v.from, p_to: v.to, p_district: v.district }),
        "approve point of sale",
      ) as number,
    ),
);
