import "server-only";
import { createClient } from "@/lib/supabase/server";
import { profileNames } from "./collections";

const num = (v: unknown) => Number(v ?? 0);

// ---- Collections by way of paying ----
export interface ChannelRow {
  channel: string;
  recorded_n: number;
  recorded: number;
  verified: number;
  reconciled: number;
  pending: number;
  disputed: number;
  duplicates: number;
  statement_total: number;
  missing_in_system_n: number;
  missing_in_system: number;
  missing_in_provider_n: number;
  missing_in_provider: number;
  mismatch_n: number;
  mismatch: number;
}

export async function collectionsChannels(from: string, to: string): Promise<ChannelRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collections_channels", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(
    (r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, k === "channel" ? v : num(v)]),
      ) as unknown as ChannelRow,
  );
}

// ---- Statement reconciliation ----
export type BatchStatus = "open" | "submitted" | "approved" | "rejected";
export interface StatementBatch {
  id: string;
  number: string;
  provider: string;
  date_from: string;
  date_to: string;
  summary: Record<string, number>;
  status: BatchStatus;
  note: string | null;
  decision_note: string | null;
  created_at: string;
  created_by: string | null;
  submitted_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  names: Record<string, string>;
}

export async function listStatementBatches(status?: BatchStatus | null): Promise<StatementBatch[]> {
  const supabase = await createClient();
  let q = supabase
    .from("reconciliation_batches")
    .select(
      "id, number, provider, date_from, date_to, summary, status, note, decision_note, created_at, created_by, submitted_by, decided_by, decided_at",
    )
    .order("created_at", { ascending: false })
    .limit(60);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Omit<StatementBatch, "names">[];
  const names = await profileNames(
    rows.flatMap((r) => [r.created_by, r.submitted_by, r.decided_by]),
  );
  return rows.map((r) => ({ ...r, names }));
}

export interface StatementLine {
  id: number;
  provider_ref: string | null;
  amount: number | null;
  system_amount: number | null;
  line_date: string | null;
  status: "matched" | "amount_mismatch" | "missing_in_system" | "missing_in_provider";
  payment_id: string | null;
  matched_by_hand: boolean;
  resolution_note: string | null;
  resolved_at: string | null;
  payment: { receipt_no: string; payer_name: string | null } | null;
}

export async function statementLines(batchId: string): Promise<StatementLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reconciliation_lines")
    .select(
      "id, provider_ref, amount, system_amount, line_date, status, payment_id, matched_by_hand, resolution_note, resolved_at, payment:payments(receipt_no, payer_name)",
    )
    .eq("batch_id", batchId)
    .order("status")
    .order("provider_ref")
    .limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StatementLine[]).map((l) => ({
    ...l,
    amount: l.amount === null ? null : num(l.amount),
    system_amount: l.system_amount === null ? null : num(l.system_amount),
  }));
}

// ---- Cash handovers ----
export interface Handover {
  id: string;
  number: string;
  shift_id: string;
  from_user: string;
  to_user: string;
  amount: number;
  note: string | null;
  status: "pending" | "received" | "disputed" | "cancelled";
  received_amount: number | null;
  difference: number | null;
  receive_note: string | null;
  created_at: string;
  received_at: string | null;
  shift: {
    number: string;
    counted_cash: number | null;
    expected_cash: number | null;
    closed_at: string | null;
  } | null;
  district: { name_so: string; name_en: string } | null;
}

// ---- Commission and revenue sharing ----
export interface CommissionRule {
  id: string;
  code: string;
  version: number;
  name: string;
  kind: "commission" | "revenue_share" | "fee";
  party: string;
  method: string | null;
  wallet: string | null;
  fee_type_id: string | null;
  district_id: string | null;
  pct: number;
  fixed_amount: number;
  payable_account: string;
  effective_from: string;
  effective_to: string | null;
  status: "draft" | "approved" | "retired";
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export async function listCommissionRules(): Promise<CommissionRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_rules")
    .select(
      "id, code, version, name, kind, party, method, wallet, fee_type_id, district_id, pct, fixed_amount, payable_account, effective_from, effective_to, status, note, created_by, approved_by, approved_at",
    )
    .order("code")
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CommissionRule[]).map((r) => ({
    ...r,
    pct: num(r.pct),
    fixed_amount: num(r.fixed_amount),
  }));
}

export interface CommissionSummaryRow {
  party: string;
  payable_account: string;
  kind: string;
  payments: number;
  base: number;
  accrued: number;
  reversed: number;
  paid: number;
  payable: number;
  in_payout: number;
}

export async function commissionSummary(from: string, to: string): Promise<CommissionSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commission_summary", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(
    (r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          ["party", "payable_account", "kind"].includes(k) ? v : num(v),
        ]),
      ) as unknown as CommissionSummaryRow,
  );
}

export interface Payout {
  id: string;
  number: string;
  party: string;
  payable_account: string;
  upto: string;
  amount: number;
  paid_from: string;
  reference: string | null;
  status: "pending" | "paid" | "rejected";
  created_by: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
}

export async function listPayouts(): Promise<Payout[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_payouts")
    .select(
      "id, number, party, payable_account, upto, amount, paid_from, reference, status, created_by, decided_by, decision_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Payout[]).map((p) => ({ ...p, amount: num(p.amount) }));
}

// ---- General ledger ----
export interface LedgerLine {
  entry_id: string;
  number: string;
  date: string;
  source: string;
  memo: string;
  debit: number;
  credit: number;
  district_id: string | null;
  balance: number;
}
export interface Ledger {
  account: { code: string; name_so: string; name_en: string; type: string };
  from: string;
  to: string;
  opening: number;
  debit: number;
  credit: number;
  lines: LedgerLine[];
}

export async function generalLedger(
  account: string,
  from: string,
  to: string,
  district: string | null,
): Promise<Ledger> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("general_ledger", {
    p_account: account,
    p_from: from,
    p_to: to,
    p_district: district,
  });
  if (error) throw new Error(error.message);
  const d = data as Ledger;
  return {
    ...d,
    opening: num(d.opening),
    debit: num(d.debit),
    credit: num(d.credit),
    lines: d.lines.map((l) => ({
      ...l,
      debit: num(l.debit),
      credit: num(l.credit),
      balance: num(l.balance),
    })),
  };
}
