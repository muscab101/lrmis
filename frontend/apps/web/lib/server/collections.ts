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
