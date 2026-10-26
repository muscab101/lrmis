import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MovementKind = "deposit" | "expense" | "income";
export type MovementStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface AccountBalance {
  code: string;
  name_so: string;
  name_en: string;
  type: string;
  is_bank: boolean;
  balance: number;
}

export interface AccountingOverview {
  from: string;
  to: string;
  balances: AccountBalance[];
  collected: number;
  other_in: number;
  money_out: number;
  deposited: number;
  billed: number;
  income: number;
  expenses: number;
  series: { day: string; in: number; out: number }[];
  by_channel: { channel: string; amount: number }[];
  expense_by_account: { code: string; name_so: string; name_en: string; amount: number }[];
  pending: Partial<Record<MovementKind, { count: number; amount: number }>>;
  assets: { count: number; cost: number; book_value: number; due: number };
}

export async function accountingOverview(from: string, to: string): Promise<AccountingOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounting_overview", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data as AccountingOverview;
}

export interface DistrictCollection {
  district_id: string;
  code: string;
  name_so: string;
  name_en: string;
  billed: number;
  collected: number;
  cash: number;
  mobile: number;
  card: number;
  bank: number;
  deposited: number;
  held: number;
  owed: number;
  pending_deposits: number;
  held_accounts: Record<string, number>;
}

export async function accountingDistricts(from: string, to: string): Promise<DistrictCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounting_districts", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as DistrictCollection),
    ...Object.fromEntries(
      [
        "billed",
        "collected",
        "cash",
        "mobile",
        "card",
        "bank",
        "deposited",
        "held",
        "owed",
        "pending_deposits",
      ].map((k) => [k, Number(r[k] ?? 0)]),
    ),
  }));
}

export interface MovementRow {
  id: string;
  number: string;
  kind: MovementKind;
  district_id: string | null;
  movement_date: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  party: string | null;
  reference: string | null;
  note: string | null;
  status: MovementStatus;
  decision_note: string | null;
  cancel_reason: string | null;
  created_at: string;
  district: { code: string; name_so: string; name_en: string } | null;
}

/** Money movements of some kinds, newest first, optionally of one status. */
export async function listMovements(
  kinds: MovementKind[],
  status?: MovementStatus | null,
  limit = 100,
): Promise<MovementRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("money_movements")
    .select(
      "id, number, kind, district_id, movement_date, debit_account, credit_account, amount, party, reference, note, status, decision_note, cancel_reason, created_at, district:districts(code, name_so, name_en)",
    )
    .in("kind", kinds)
    .order("movement_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MovementRow[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));
}

export interface AssetRow {
  id: string;
  number: string;
  name: string;
  category: string;
  district_id: string | null;
  location: string | null;
  serial_no: string | null;
  acquired_on: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  funded_from: string;
  status: "active" | "disposed";
  disposed_on: string | null;
  disposal_amount: number | null;
  note: string | null;
  depreciated: number;
  book_value: number;
  last_month: string | null;
}

export async function listAssets(): Promise<AssetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixed_assets_book")
    .select("*")
    .order("status")
    .order("acquired_on", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as AssetRow[]).map((r) => ({
    ...r,
    cost: Number(r.cost),
    salvage_value: Number(r.salvage_value),
    depreciated: Number(r.depreciated),
    book_value: Number(r.book_value),
    disposal_amount: r.disposal_amount === null ? null : Number(r.disposal_amount),
  }));
}
