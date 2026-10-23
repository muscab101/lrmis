import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** The columns every collections report splits money into (Card is Visa / Mastercard; Other is cheques and the rest). */
export const CHANNELS = ["cash", "evc_plus", "edahab", "zaad", "bank_transfer", "card", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const WALLETS = ["evc_plus", "edahab", "zaad"] as const;
export type Wallet = (typeof WALLETS)[number];

export const EVIDENCE_BUCKET = "payment-evidence";

export interface PaymentExtras {
  wallet: string | null;
  expected_amount: number | null;
  amount_base: number;
  created_by: string | null;
  evidence: { id: string; file_name: string; content_type: string; note: string | null; uploaded_at: string; url: string | null; by: string | null }[];
}

/** Wallet, what was owed, and the evidence files (signed for a few minutes) for one payment. */
export async function paymentExtras(id: string): Promise<PaymentExtras | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("wallet, expected_amount, amount_base, created_by").eq("id", id).maybeSingle();
  if (!data) return null;
  const files = unwrap(
    await supabase.from("payment_evidence").select("id, storage_path, file_name, content_type, note, uploaded_at, uploaded_by").eq("payment_id", id).order("uploaded_at"),
    "evidence",
  ) as { id: string; storage_path: string; file_name: string; content_type: string; note: string | null; uploaded_at: string; uploaded_by: string | null }[];
  let urls: Record<string, string> = {};
  if (files.length) {
    // The rows above came through the caller's own access; only those files are signed.
    const admin = await createAdminClient();
    const { data: signed } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrls(files.map((f) => f.storage_path), 600);
    urls = Object.fromEntries((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path!, s.signedUrl as string]));
  }
  const names = await profileNames(files.map((f) => f.uploaded_by));
  const d = data as { wallet: string | null; expected_amount: number | null; amount_base: number; created_by: string | null };
  return {
    ...d,
    evidence: files.map((f) => ({ id: f.id, file_name: f.file_name, content_type: f.content_type, note: f.note, uploaded_at: f.uploaded_at, url: urls[f.storage_path] ?? null, by: f.uploaded_by ? (names[f.uploaded_by] ?? null) : null })),
  };
}

export async function profileNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return {} as Record<string, string>;
  const supabase = await createClient();
  // Finance staff can't read other users' profiles; this returns names only.
  const { data } = await supabase.rpc("staff_names", { p_ids: list });
  return Object.fromEntries(((data ?? []) as { user_id: string; full_name: string }[]).map((p) => [p.user_id, p.full_name]));
}

export interface DuplicateRow {
  kind: "same_reference" | "same_amount";
  key: string;
  payment_id: string;
  receipt_no: string;
  received_at: string;
  method: string;
  wallet: string | null;
  reference: string | null;
  amount: number;
  pun: string | null;
  payer: string | null;
  cashier: string | null;
  status: string;
}

export async function listDuplicates(from: string, to: string) {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("payment_duplicates", { p_from: from, p_to: to }), "duplicates") as DuplicateRow[];
}

export type VerifyStatus = "pending" | "verified" | "reconciled" | "disputed";
export const VERIFY_STATUSES: readonly VerifyStatus[] = ["pending", "verified", "reconciled", "disputed"];

export interface QueueRow {
  payment_id: string;
  receipt_no: string;
  received_at: string;
  method: string;
  wallet: string | null;
  channel: Channel;
  reference: string | null;
  amount: number;
  expected_amount: number | null;
  pun: string | null;
  payer: string | null;
  cashier_id: string | null;
  cashier: string | null;
  district_so: string | null;
  district_en: string | null;
  verify_status: VerifyStatus;
  dispute_reason: string | null;
  verified_by: string | null;
  evidence: number;
  correction_pending: boolean;
}

export async function listQueue(opts: { status: VerifyStatus | null; from: string; to: string; cashier?: string | null }) {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("collections_queue", { p_status: opts.status, p_from: opts.from, p_to: opts.to, p_cashier: opts.cashier ?? null }),
    "collections queue",
  ) as QueueRow[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount), expected_amount: r.expected_amount === null ? null : Number(r.expected_amount), evidence: Number(r.evidence) }));
}

/** A payment's verification state, for its own page. */
export async function paymentVerification(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("verify_status, verified_by, verified_at, dispute_reason").eq("id", id).maybeSingle();
  const v = data as { verify_status: VerifyStatus; verified_by: string | null; verified_at: string | null; dispute_reason: string | null } | null;
  if (!v) return null;
  const names = await profileNames([v.verified_by]);
  return { ...v, verified_by_name: v.verified_by ? (names[v.verified_by] ?? null) : null };
}

export interface CorrectionRow {
  id: string;
  number: string;
  payment_id: string;
  before: Record<string, string | null>;
  changes: Record<string, string | null>;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payment: { receipt_no: string; amount_base: number } | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
}

export async function listCorrections(opts: { status: "pending" | "any"; paymentId?: string }) {
  const supabase = await createClient();
  let req = supabase
    .from("payment_corrections")
    .select("id, number, payment_id, before, changes, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, payment:payments(receipt_no, amount_base)");
  if (opts.status === "pending") req = req.eq("status", "pending");
  if (opts.paymentId) req = req.eq("payment_id", opts.paymentId);
  const rows = unwrap(await req.order("requested_at", { ascending: false }).limit(200), "corrections") as unknown as Omit<CorrectionRow, "requested_by_name" | "decided_by_name">[];
  const names = await profileNames(rows.flatMap((r) => [r.requested_by, r.decided_by]));
  return rows.map((r) => ({
    ...r,
    requested_by_name: r.requested_by ? (names[r.requested_by] ?? null) : null,
    decided_by_name: r.decided_by ? (names[r.decided_by] ?? null) : null,
  })) as CorrectionRow[];
}

export interface CashierDay {
  cashier_id: string;
  cashier: string | null;
  business_date: string;
  district_id: string | null;
  payments: number;
  recorded: number;
  pending: number;
  verified: number;
  disputed: number;
  reconciliation_id: string | null;
  number: string | null;
  status: "submitted" | "approved" | "rejected" | null;
  actual: number | null;
  difference: number | null;
}

export async function listCashierDays(from: string, to: string) {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("cashier_days", { p_from: from, p_to: to }), "cashier days") as CashierDay[];
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({ ...r, payments: Number(r.payments), recorded: Number(r.recorded), pending: Number(r.pending), verified: Number(r.verified), disputed: Number(r.disputed), actual: n(r.actual), difference: n(r.difference) }));
}

export interface DayChannel {
  channel: Channel;
  payments: number;
  recorded: number;
  suggested: number;
  pending: number;
  disputed: number;
}

export async function cashierDaySummary(cashierId: string, date: string) {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("cashier_day_summary", { p_cashier: cashierId, p_date: date }), "day summary") as DayChannel[];
  return rows.map((r) => ({ ...r, payments: Number(r.payments), recorded: Number(r.recorded), suggested: Number(r.suggested), pending: Number(r.pending), disputed: Number(r.disputed) }));
}

export interface Reconciliation {
  id: string;
  number: string;
  cashier_id: string;
  business_date: string;
  status: "submitted" | "approved" | "rejected";
  recorded: number;
  actual: number;
  difference: number;
  note: string | null;
  prepared_by: string | null;
  prepared_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  lines: { channel: Channel; payments: number; recorded: number; actual: number; difference: number; shortage: number; excess: number }[];
  prepared_by_name: string | null;
  decided_by_name: string | null;
}

/** A cashier day's reconciliations, newest first (rejected ones stay for the record). */
export async function dayReconciliations(cashierId: string, date: string) {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("cashier_reconciliations")
      .select("id, number, cashier_id, business_date, status, recorded, actual, difference, note, prepared_by, prepared_at, decided_by, decided_at, decision_note, lines:cashier_reconciliation_lines(channel, payments, recorded, actual, difference, shortage, excess)")
      .eq("cashier_id", cashierId)
      .eq("business_date", date)
      .order("prepared_at", { ascending: false }),
    "reconciliations",
  ) as unknown as Omit<Reconciliation, "prepared_by_name" | "decided_by_name">[];
  const names = await profileNames([cashierId, ...rows.flatMap((r) => [r.prepared_by, r.decided_by])]);
  const order = (c: string) => (CHANNELS as readonly string[]).indexOf(c);
  return {
    cashierName: names[cashierId] ?? null,
    items: rows.map((r) => ({
      ...r,
      recorded: Number(r.recorded),
      actual: Number(r.actual),
      difference: Number(r.difference),
      lines: r.lines
        .map((l) => ({ ...l, recorded: Number(l.recorded), actual: Number(l.actual), difference: Number(l.difference), shortage: Number(l.shortage), excess: Number(l.excess) }))
        .sort((a, b) => order(a.channel) - order(b.channel)),
      prepared_by_name: r.prepared_by ? (names[r.prepared_by] ?? null) : null,
      decided_by_name: r.decided_by ? (names[r.decided_by] ?? null) : null,
    })) as Reconciliation[],
  };
}
