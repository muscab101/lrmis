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
  const { data } = await supabase.from("profiles").select("user_id, full_name").in("user_id", list);
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
