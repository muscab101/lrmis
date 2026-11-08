import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import { normalizePun, punFilter } from "@/lib/pun";
import { getLandUnits } from "./parcels";

export type PaymentStatus = "completed" | "unmatched" | "reversed";
export type PaymentMethod = "cash" | "cheque" | "mobile_money" | "card" | "bank_transfer";

export interface PaymentRow {
  id: string;
  receipt_no: string;
  method: PaymentMethod;
  provider: string | null;
  provider_ref: string | null;
  reference: string | null;
  currency: string;
  amount: number;
  amount_base: number;
  unallocated: number;
  status: PaymentStatus;
  received_at: string;
  payer_name: string | null;
  payer_phone: string | null;
  parcel: { id: string; pun: string | null } | null;
}

const PAYMENT_COLUMNS =
  "id, receipt_no, method, provider, provider_ref, reference, currency, amount, amount_base, unallocated, status, received_at, payer_name, payer_phone, parcel:parcels(id, pun)";

export async function listPayments(opts: {
  status?: PaymentStatus | "any";
  q?: string;
  shiftId?: string;
  parcelId?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  let req = supabase.from("payments").select(PAYMENT_COLUMNS);
  if (opts.status && opts.status !== "any") req = req.eq("status", opts.status);
  if (opts.shiftId) req = req.eq("shift_id", opts.shiftId);
  if (opts.parcelId) req = req.eq("parcel_id", opts.parcelId);
  const term = (opts.q ?? "").replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    // A receipt or reference, or the PUN of the land (dashes and an old BN typed from a printout are ignored).
    const { data } = await supabase
      .from("parcels")
      .select("id")
      .or(`pun.ilike.%${normalizePun(term)}%,pun_old.ilike.%${normalizePun(term)}%`)
      .limit(50);
    const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
    req = req.or(
      [`receipt_no.ilike.%${term}%`, `provider_ref.ilike.%${term}%`, `reference.ilike.%${term}%`, ...(ids.length ? [`parcel_id.in.(${ids.join(",")})`] : [])].join(","),
    );
  }
  return unwrap(
    await req.order("received_at", { ascending: false }).limit(opts.limit ?? 100),
    "payments",
  ) as unknown as PaymentRow[];
}

export interface PaymentDetail extends PaymentRow {
  fx_rate: number;
  note: string | null;
  created_by: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  district_id: string | null;
  pos: { code: string; name: string } | null;
  shift: { id: string; number: string } | null;
  payment_allocations: {
    id: number;
    amount: number;
    discount: number;
    invoice: { id: string; number: string; period: string } | null;
  }[];
  payment_reversals: {
    id: string;
    reason: string;
    status: "pending" | "approved" | "rejected";
    requested_by: string | null;
    requested_at: string;
    decision_note: string | null;
  }[];
}

export async function getPayment(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("payments")
    .select(
      `${PAYMENT_COLUMNS}, fx_rate, note, created_by, reversal_reason, reversed_at, district_id,
       pos:points_of_sale(code, name), shift:cashier_shifts(id, number),
       payment_allocations(id, amount, discount, invoice:invoices(id, number, period)),
       payment_reversals(id, reason, status, requested_by, requested_at, decision_note)`,
    )
    .eq("id", id)
    .maybeSingle();
  return unwrap(res, "payment") as unknown as PaymentDetail | null;
}

export interface ShiftRow {
  id: string;
  number: string;
  status: "open" | "closed" | "approved";
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  close_note: string | null;
  cashier_id: string;
  pos: { id: string; code: string; name: string } | null;
}

const SHIFT_COLUMNS =
  "id, number, status, opened_at, closed_at, opening_float, expected_cash, counted_cash, difference, close_note, cashier_id, pos:points_of_sale(id, code, name)";

export async function myOpenShift() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("cashier_shifts")
    .select(SHIFT_COLUMNS)
    .eq("cashier_id", user?.id ?? "")
    .eq("status", "open")
    .maybeSingle();
  return (data as unknown as ShiftRow | null) ?? null;
}

export async function listShifts(status: "closed" | "any") {
  const supabase = await createClient();
  let req = supabase.from("cashier_shifts").select(SHIFT_COLUMNS);
  if (status === "closed") req = req.eq("status", "closed");
  return unwrap(
    await req.order("opened_at", { ascending: false }).limit(50),
    "shifts",
  ) as unknown as ShiftRow[];
}

export async function listPointsOfSale(forUser?: {
  id: string;
  allDistricts: boolean;
  posId: string | null;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("points_of_sale")
    .select("id, code, name, kind, district_id, active")
    .eq("active", true)
    .neq("kind", "online")
    .order("code");
  let rows = (data ?? []) as {
    id: string;
    code: string;
    name: string;
    kind: string;
    district_id: string | null;
  }[];
  if (forUser) {
    // A cashier sees the desks of their own districts, with their own desk first.
    if (!forUser.allDistricts) {
      const { data: mine } = await supabase
        .from("user_districts")
        .select("district_id")
        .eq("user_id", forUser.id);
      const ids = new Set((mine ?? []).map((r) => r.district_id as string));
      rows = rows.filter((r) => r.district_id === null || ids.has(r.district_id));
    }
    rows.sort((a, b) => Number(b.id === forUser.posId) - Number(a.id === forUser.posId));
  }
  return rows;
}

export async function listProviders() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_providers")
    .select("code, name, method, enabled, sort")
    .order("sort");
  return (data ?? []) as { code: string; name: string; method: PaymentMethod; enabled: boolean }[];
}

export async function paymentsCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("payments_counts");
  return (data ?? {
    today: 0,
    today_count: 0,
    unmatched: 0,
    reversals_pending: 0,
    shifts_open: 0,
    shifts_to_approve: 0,
  }) as {
    today: number;
    today_count: number;
    unmatched: number;
    reversals_pending: number;
    shifts_open: number;
    shifts_to_approve: number;
  };
}

export interface ReversalRow {
  id: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  payment: {
    id: string;
    receipt_no: string;
    amount_base: number;
    parcel: { pun: string | null } | null;
  } | null;
}

export async function listReversals(status: "pending" | "any") {
  const supabase = await createClient();
  let req = supabase
    .from("payment_reversals")
    .select(
      "id, reason, status, requested_by, requested_at, payment:payments(id, receipt_no, amount_base, parcel:parcels(pun))",
    );
  if (status === "pending") req = req.eq("status", "pending");
  return unwrap(
    await req.order("requested_at", { ascending: false }).limit(100),
    "reversals",
  ) as unknown as ReversalRow[];
}

export interface ReconBatch {
  id: string;
  number: string;
  provider: string;
  date_from: string;
  date_to: string;
  summary: Record<string, number>;
  created_at: string;
}

export async function listReconBatches() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reconciliation_batches")
    .select("id, number, provider, date_from, date_to, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as ReconBatch[];
}

export async function reconLines(batchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reconciliation_lines")
    .select("id, provider_ref, amount, system_amount, line_date, status, payment_id")
    .eq("batch_id", batchId)
    .neq("status", "matched")
    .order("status")
    .limit(500);
  return (data ?? []) as {
    id: number;
    provider_ref: string | null;
    amount: number | null;
    system_amount: number | null;
    line_date: string | null;
    status: string;
    payment_id: string | null;
  }[];
}

// ---- Accounting ----
export async function trialBalance(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trial_balance", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    account: string;
    name_so: string;
    name_en: string;
    type: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
}

export async function listJournal(limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select(
      "id, number, entry_date, source, memo, total, reverses, reversed_by, journal_lines(id, account, debit, credit)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as {
    id: string;
    number: string;
    entry_date: string;
    source: string;
    memo: string;
    total: number;
    reverses: string | null;
    reversed_by: string | null;
    journal_lines: { id: number; account: string; debit: number; credit: number }[];
  }[];
}

export async function listAccounts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gl_accounts")
    .select("code, name_so, name_en, type, is_bank, active")
    .order("code");
  return (data ?? []) as {
    code: string;
    name_so: string;
    name_en: string;
    type: string;
    is_bank: boolean;
    active: boolean;
  }[];
}

export async function listFxRates() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fx_rates")
    .select("id, currency, rate_date, rate")
    .order("rate_date", { ascending: false })
    .limit(60);
  return (data ?? []) as { id: string; currency: string; rate_date: string; rate: number }[];
}

export async function listPeriods() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fiscal_periods")
    .select("year, month, status, locked_at")
    .order("year", { ascending: false })
    .order("month", { ascending: false });
  return (data ?? []) as {
    year: number;
    month: number;
    status: "open" | "locked";
    locked_at: string | null;
  }[];
}

/** Open invoices of a parcel found by PUN (for the cashier). */
/**
 * The parcel the cashier takes money for, found by PUN, invoice number (INV-… or SCIN-…) or application
 * number (APP-…). Before registration a parcel has no PUN, so the application fee is found by
 * its invoice or application number.
 */
export async function parcelForCashier(term: string) {
  const supabase = await createClient();
  const key = term.trim().toUpperCase();
  const cols =
    "id, pun, status, building_state, account_no, district_id, layout, application:applications!parcels_application_id_fkey(number)";
  let parcelId: string | null = null;
  if (key.startsWith("INV-") || key.startsWith("SCIN-")) {
    const { data } = await supabase
      .from("invoices")
      .select("parcel_id")
      .eq("number", key)
      .maybeSingle();
    parcelId = (data as { parcel_id: string } | null)?.parcel_id ?? null;
  } else if (key.startsWith("APP-")) {
    const { data } = await supabase
      .from("applications")
      .select("parcel_id")
      .eq("number", key)
      .maybeSingle();
    parcelId = (data as { parcel_id: string | null } | null)?.parcel_id ?? null;
  }
  const { data: p } = parcelId
    ? await supabase.from("parcels").select(cols).eq("id", parcelId).maybeSingle()
    : await supabase.from("parcels").select(cols).or(punFilter(normalizePun(key))).maybeSingle();
  if (!p) return null;
  const parcel = p as unknown as {
    id: string;
    pun: string | null;
    status: string;
    building_state: string;
    account_no: string | null;
    district_id: string;
    layout: string;
    application: { number: string } | null;
  };
  // A flats building or compound holds no bills: the cashier picks one of its units. Units that were demolished stay as a record.
  const land = await getLandUnits(parcel.id);
  const units = parcel.layout === "house" ? [] : land.units;
  const [{ data: inv }, { data: owners }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, period, due_date, balance, discount_until, early_discount_pct, paid")
      .eq("parcel_id", parcel.id)
      .in("status", ["issued", "partially_paid"])
      .order("due_date"),
    supabase
      .from("parcel_owners")
      .select("role, party:parties(full_name, phone)")
      .eq("parcel_id", parcel.id)
      .is("valid_to", null),
  ]);
  type Person = { role: string; party: { full_name: string; phone: string | null } | null };
  let people = (owners ?? []) as unknown as Person[];
  // Not registered yet: the owners named on the application.
  if (people.length === 0 && parcel.application) {
    const { data: app } = await supabase
      .from("applications")
      .select("application_parties(role, party:parties(full_name, phone))")
      .eq("number", parcel.application.number)
      .maybeSingle();
    people = ((app as { application_parties?: Person[] } | null)?.application_parties ?? []).filter((x) => x.role !== "witness");
  }
  // The payer the cashier starts with: the main owner (the first co-owner when there is none).
  const main = people.find((x) => x.role === "owner" && x.party) ?? people.find((x) => x.party);
  return {
    parcel,
    units,
    owners: people.map((o) => o.party?.full_name).filter(Boolean) as string[],
    payer: { name: main?.party?.full_name ?? "", phone: main?.party?.phone ?? "" },
    invoices: (inv ?? []) as {
      id: string;
      number: string;
      period: string;
      due_date: string;
      balance: number;
      discount_until: string | null;
      early_discount_pct: number;
      paid: number;
    }[],
  };
}
