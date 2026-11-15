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
  /** The point(s) of sale the cashier took the day's money at, e.g. "11 Karaan office". */
  pos_names: string | null;
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

export async function listCashierDays(from: string, to: string, pos: string | null = null) {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("cashier_days", { p_from: from, p_to: to, p_pos: pos }), "cashier days") as CashierDay[];
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

export interface CollectionsDashboard {
  today: { all: number; verified: number; n: number };
  week: { all: number; verified: number; n: number };
  month: { all: number; verified: number; n: number };
  channels: Partial<Record<Channel, number>>;
  status: Partial<Record<VerifyStatus, { n: number; amount: number }>>;
  shortage: number;
  excess: number;
  recon_waiting: number;
  corrections_waiting: number;
  week_from: string;
  month_from: string;
  as_of: string;
}

export async function collectionsDashboard() {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("collections_dashboard", {}), "collections dashboard") as CollectionsDashboard;
}

/** One point of sale's account for a period: the money its cashiers took, what is approved and what waits. */
export interface PosCollections {
  id: string;
  code: string;
  name: string;
  district_id: string | null;
  district_so: string | null;
  district_en: string | null;
  payments: number;
  total: number;
  approved: number;
  waiting: number;
  disputed: number;
  /** Money by way of paying: cash, evc_plus, edahab, zaad, bank_transfer, card, other. */
  channels: Record<string, number>;
  /** Money by bill type (what it paid for), in the fee types' order. */
  bill_types: BillTypeTotal[];
  cashiers: {
    cashier_id: string | null;
    cashier: string | null;
    /** Online payments for land in this office's district (paid through the portal, pay link, USSD or WhatsApp). */
    online: boolean;
    /** The point of sale the payments were taken at (the Online one for online rows). */
    pos_id: string;
    payments: number;
    total: number;
    approved: number;
    waiting: number;
    waiting_count: number;
    disputed: number;
    channels: Record<string, number>;
    /** Money by bill type code (what it paid for). */
    bill_types: Record<string, number>;
  }[];
}

export interface BillTypeTotal {
  code: string;
  name_so: string;
  name_en: string;
  total: number;
}

/** Points of sale with money in the period, or only the chosen one (shown even when it took nothing). */
export async function collectionsByPos(from: string, to: string, pos: string | null) {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("collections_by_pos", { p_from: from, p_to: to, p_pos: pos }), "collections by pos") as PosCollections[];
}

/** The points of sale to choose from: those in your districts, and Online payments. */
export async function collectionsPosChoices() {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("collections_pos_choices"), "pos choices") as {
    id: string;
    code: string;
    name: string;
    district_so: string | null;
    district_en: string | null;
  }[];
}

/** One payment behind a cashier's row of a point of sale's account (the cashier's info on the Point of sale page). */
export interface PosPaymentRow {
  payment_id: string;
  receipt_no: string;
  received_at: string;
  channel: string;
  reference: string | null;
  amount: number;
  pun: string | null;
  house_no: string | null;
  neighbourhood: string | null;
  /** The land's current owners. */
  owners: string | null;
  payer: string | null;
  payer_phone: string | null;
  verify_status: VerifyStatus;
  verified_by: string | null;
  verified_at: string | null;
  /** The bills this payment paid: type, bill number and how much went on it. */
  bills: { code: string; name_so: string; name_en: string; number: string; amount: number }[];
}

/** The payments behind one cashier's row: at one point of sale, in the period; for a district's online row, only that district's. */
export async function posCashierPayments(pos: string, cashier: string | null, from: string, to: string, district: string | null) {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.rpc("pos_cashier_payments", { p_pos: pos, p_cashier: cashier, p_from: from, p_to: to, p_district: district }),
    "point of sale payments",
  ) as PosPaymentRow[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}
