import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export type RunStatus = "draft" | "submitted" | "approved" | "generating" | "issued" | "cancelled";
export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled";

export interface RunPreview {
  parcels?: number;
  count?: number;
  total?: number;
  exceptions?: { already_invoiced: number; no_assessment: number; zero_amount: number };
  at?: string;
}

export interface RunRow {
  id: string;
  number: string;
  year: number;
  period: string;
  status: RunStatus;
  district_ids: string[];
  neighbourhood_ids: string[];
  due_date: string;
  issue_date: string;
  preview: RunPreview;
  invoice_count: number;
  total: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  approved_by: string | null;
  cancel_reason: string | null;
  fee_type: { code: string; name_so: string; name_en: string } | null;
}

const RUN_COLUMNS =
  "id, number, year, period, status, district_ids, neighbourhood_ids, due_date, issue_date, preview, invoice_count, total, note, created_at, created_by, approved_by, cancel_reason, fee_type:fee_types(code, name_so, name_en)";

export async function listRuns() {
  const supabase = await createClient();
  return unwrap(await supabase.from("billing_runs").select(RUN_COLUMNS).order("created_at", { ascending: false }).limit(100), "runs") as unknown as RunRow[];
}

export async function getRun(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  return unwrap(await supabase.from("billing_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle(), "run") as unknown as RunRow | null;
}

export interface InvoiceRow {
  id: string;
  number: string;
  period: string;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  status: InvoiceStatus;
  parcel: { id: string; pun: string | null } | null;
  fee_type: { code: string; name_so: string; name_en: string } | null;
}

const INVOICE_COLUMNS = "id, number, period, issue_date, due_date, total, paid, credited, balance, status, parcel:parcels(id, pun), fee_type:fee_types(code, name_so, name_en)";
export type InvoiceFilter = "open" | "overdue" | "paid" | "cancelled" | "any";

export async function listInvoices(opts: { filter: InvoiceFilter; q: string; runId?: string; parcelId?: string; page?: number }) {
  const supabase = await createClient();
  let req = supabase.from("invoices").select(INVOICE_COLUMNS, { count: "exact" });
  const today = new Date().toISOString().slice(0, 10);
  if (opts.filter === "open") req = req.in("status", ["issued", "partially_paid"]);
  else if (opts.filter === "overdue") req = req.in("status", ["issued", "partially_paid"]).lt("due_date", today);
  else if (opts.filter !== "any") req = req.eq("status", opts.filter);
  if (opts.runId) req = req.eq("run_id", opts.runId);
  if (opts.parcelId) req = req.eq("parcel_id", opts.parcelId);
  const term = opts.q.replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    if (/^inv/i.test(term)) req = req.ilike("number", `%${term}%`);
    else {
      const { data } = await supabase.from("parcels").select("id").ilike("pun", `%${term.replace(/-/g, "")}%`).limit(50);
      const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
      req = req.in("parcel_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
  }
  const page = opts.page ?? 1;
  // A tax bill and its service charge share a number: keep them together, INV before SV.
  const res = await req.order("number_key", { ascending: false }).order("number", { ascending: true }).range((page - 1) * 50, page * 50 - 1);
  return { rows: unwrap(res, "invoices") as unknown as InvoiceRow[], total: res.count ?? 0 };
}

export interface InvoiceDetail extends InvoiceRow {
  district_id: string;
  run_id: string | null;
  discount_until: string | null;
  early_discount_pct: number;
  currency: string;
  note: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  penalty_applied_at: string | null;
  parcel: { id: string; pun: string | null; account_no: string | null; area_m2: number | null; land_use: string; neighbourhood: { name_so: string; name_en: string } | null; district: { name_so: string; name_en: string } | null } | null;
  invoice_lines: { id: string; kind: string; description: string; amount: number; created_at: string }[];
  credit_notes: { id: string; number: string; amount: number; reason: string; status: "pending" | "approved" | "rejected"; requested_by: string | null; requested_at: string; decision_note: string | null }[];
  run: { id: string; number: string } | null;
}

export async function getInvoice(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("invoices")
    .select(
      `id, number, period, issue_date, due_date, total, paid, credited, balance, status, district_id, run_id, discount_until, early_discount_pct, currency, note, cancel_reason, created_by, penalty_applied_at,
       fee_type:fee_types(code, name_so, name_en),
       parcel:parcels(id, pun, account_no, area_m2, land_use, neighbourhood:neighbourhoods(name_so, name_en), district:districts(name_so, name_en)),
       invoice_lines(id, kind, description, amount, created_at),
       credit_notes(id, number, amount, reason, status, requested_by, requested_at, decision_note),
       run:billing_runs(id, number)`,
    )
    .eq("id", id)
    .maybeSingle();
  const inv = unwrap(res, "invoice") as unknown as InvoiceDetail | null;
  if (inv) inv.invoice_lines.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return inv;
}

export async function getPayLink(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoice_pay_link", { p_id: id });
  return (data as string | null) ?? null;
}

export async function parcelOwnersFor(parcelId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("parcel_owners").select("share_pct, party:parties(full_name, phone)").eq("parcel_id", parcelId).is("valid_to", null);
  return (data ?? []) as unknown as { share_pct: number | null; party: { full_name: string; phone: string | null } | null }[];
}

export interface PlanRow {
  id: string;
  number: string;
  total: number;
  instalments: number;
  start_date: string;
  status: "pending" | "active" | "completed" | "rejected" | "cancelled" | "defaulted";
  note: string | null;
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
  parcel: { id: string; pun: string | null } | null;
  payment_plan_installments: { seq: number; due_date: string; amount: number; paid: number }[];
}

export async function listPlans(opts: { status: "pending" | "any"; parcelId?: string }) {
  const supabase = await createClient();
  let req = supabase
    .from("payment_plans")
    .select("id, number, total, instalments, start_date, status, note, requested_by, requested_at, decision_note, parcel:parcels(id, pun), payment_plan_installments(seq, due_date, amount, paid)");
  if (opts.status === "pending") req = req.eq("status", "pending");
  if (opts.parcelId) req = req.eq("parcel_id", opts.parcelId);
  const rows = unwrap(await req.order("requested_at", { ascending: false }).limit(100), "plans") as unknown as PlanRow[];
  for (const r of rows) r.payment_plan_installments.sort((a, b) => a.seq - b.seq);
  return rows;
}

export interface CreditNoteRow {
  id: string;
  number: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
  invoice: { id: string; number: string; balance: number; parcel: { pun: string | null } | null } | null;
}

export async function listCreditNotes(status: "pending" | "any") {
  const supabase = await createClient();
  let req = supabase.from("credit_notes").select("id, number, amount, reason, status, requested_by, requested_at, decision_note, invoice:invoices(id, number, balance, parcel:parcels(pun))");
  if (status === "pending") req = req.eq("status", "pending");
  return unwrap(await req.order("requested_at", { ascending: false }).limit(100), "credit notes") as unknown as CreditNoteRow[];
}

export async function billingCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("billing_counts");
  return (data ?? { runs_waiting: 0, invoices_open: 0, invoices_overdue: 0, outstanding: 0, credit_notes_pending: 0, plans_pending: 0 }) as {
    runs_waiting: number;
    invoices_open: number;
    invoices_overdue: number;
    outstanding: number;
    credit_notes_pending: number;
    plans_pending: number;
  };
}

export async function recurringFeeTypes() {
  const supabase = await createClient();
  const { data } = await supabase.from("fee_types").select("id, code, name_so, name_en, interval, amount").eq("active", true).order("sort");
  return (data ?? []) as { id: string; code: string; name_so: string; name_en: string; interval: string; amount: number }[];
}
