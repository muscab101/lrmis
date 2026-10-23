import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface Kpis {
  applications?: { open: number; submitted_month: number; by_status: Record<string, number> };
  parcels?: { registered: number; registered_month: number; disputed: number; area_ha: number };
  finance?: {
    collected_month: number;
    collected_year: number;
    outstanding: number;
    overdue: number;
    billed_year: number;
    paid_year: number;
    trend: { month: string; amount: number }[];
  };
  tasks: Record<"surveys" | "transfers" | "permits" | "changes" | "disputes" | "campaigns" | "messages_failed", number>;
}

export async function dashboardKpis(): Promise<Kpis> {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("dashboard_kpis"), "dashboard") as Kpis;
}

export const REPORTS = [
  "revenue",
  "billing",
  "invoices",
  "payments",
  "certificates",
  "parcels",
  "owners",
  "locations",
  "arrears",
  "collection",
  "income",
  "registrations",
  "cashiers",
] as const;
export type ReportName = (typeof REPORTS)[number];

export interface ReportArgs {
  from: string;
  to: string;
  district?: string | null;
  /** Narrow to one section, sector or neighbourhood (reports in AREA_REPORTS). */
  section?: string | null;
  sector?: string | null;
  neighbourhood?: string | null;
  /** Parcels only: all, registered or partial (not yet registered). */
  kind?: ParcelKind;
}

export const PARCEL_KINDS = ["all", "registered", "partial"] as const;
export type ParcelKind = (typeof PARCEL_KINDS)[number];

/** Reports that list what exists now rather than what happened in a period. */
export const SNAPSHOT_REPORTS: readonly ReportName[] = ["arrears", "parcels", "owners", "locations"];
/** Reports that take a district filter. */
export const DISTRICT_REPORTS: readonly ReportName[] = [
  "revenue",
  "billing",
  "income",
  "arrears",
  "collection",
  "registrations",
  "invoices",
  "payments",
  "certificates",
  "parcels",
  "owners",
  "locations",
];
/** Reports that also take a section, sector and neighbourhood filter. */
export const AREA_REPORTS: readonly ReportName[] = DISTRICT_REPORTS.filter((r) => r !== "income");

/** Reports grouped by what they are about, in the order the page shows them. */
export const REPORT_GROUPS: { key: "money" | "land" | "documents"; reports: ReportName[] }[] = [
  { key: "money", reports: ["revenue", "billing", "invoices", "payments", "arrears", "collection", "income", "cashiers"] },
  { key: "land", reports: ["parcels", "owners", "locations", "registrations"] },
  { key: "documents", reports: ["certificates"] },
];

/** Reports about the same things, offered as next steps from each report (filters carry over). */
export const RELATED_REPORTS: Record<ReportName, ReportName[]> = {
  revenue: ["payments", "billing", "income"],
  billing: ["invoices", "collection", "arrears"],
  invoices: ["payments", "billing", "arrears"],
  payments: ["invoices", "revenue", "cashiers"],
  arrears: ["invoices", "collection"],
  collection: ["billing", "invoices", "arrears"],
  income: ["revenue", "payments"],
  cashiers: ["payments"],
  parcels: ["owners", "locations", "certificates", "invoices"],
  owners: ["parcels", "certificates"],
  locations: ["parcels", "owners"],
  registrations: ["parcels", "certificates"],
  certificates: ["parcels", "owners"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** District, section, sector and neighbourhood from ?district=&section=&sector=&nbhd= (ids only). */
export function reportArea(sp: Record<string, string | undefined>) {
  const id = (v: string | undefined) => (v && UUID.test(v) ? v : null);
  return { district: id(sp.district), section: id(sp.section), sector: id(sp.sector), neighbourhood: id(sp.nbhd) };
}

/** Runs one report RPC. The functions check `reports.view` and district access themselves. */
export async function runReport(name: ReportName, args: ReportArgs, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  const d = args.district || null;
  const area = { p_section: args.section || null, p_sector: args.sector || null, p_neighbourhood: args.neighbourhood || null };
  switch (name) {
    case "revenue":
      return unwrap(await supabase.rpc("report_revenue", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as RevenueRow[];
    case "arrears":
      return unwrap(await supabase.rpc("report_arrears", { p_district: d, ...area }), "report") as ArrearsRow[];
    case "collection":
      return unwrap(await supabase.rpc("report_collection", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as CollectionRow[];
    case "registrations":
      return unwrap(await supabase.rpc("report_registrations", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as RegistrationRow[];
    case "income":
      return unwrap(await supabase.rpc("report_income_expense", { p_from: args.from, p_to: args.to, p_district: d }), "report") as IncomeRow[];
    case "cashiers":
      return unwrap(await supabase.rpc("report_cashiers", { p_from: args.from, p_to: args.to }), "report") as CashierRow[];
    case "billing":
      return unwrap(await supabase.rpc("report_billing", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as BillingRow[];
    case "invoices":
      return unwrap(await supabase.rpc("report_invoices", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as InvoiceRow[];
    case "payments":
      return unwrap(await supabase.rpc("report_payments", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as PaymentRow[];
    case "certificates":
      return unwrap(await supabase.rpc("report_certificates", { p_from: args.from, p_to: args.to, p_district: d, ...area }), "report") as CertificateRow[];
    case "parcels":
      return unwrap(await supabase.rpc("report_parcels", { p_district: d, p_kind: args.kind ?? "all", ...area }), "report") as ParcelRow[];
    case "owners":
      return unwrap(await supabase.rpc("report_owners", { p_district: d, ...area }), "report") as OwnerRow[];
    case "locations":
      return unwrap(await supabase.rpc("report_locations", { p_district: d, ...area }), "report") as LocationRow[];
  }
}

export interface RevenueRow { month: string; fee_type: string; fee_name_so: string; fee_name_en: string; amount: number; payments: number }
export interface ArrearsRow { district_id: string; district_so: string; district_en: string; invoices: number; not_due: number; d1_30: number; d31_90: number; d91_180: number; d180: number; total: number }
export interface CollectionRow { district_id: string; district_so: string; district_en: string; invoices: number; billed: number; collected: number; credited: number; outstanding: number; rate: number }
export interface RegistrationRow { month: string; submitted: number; registered: number; rejected: number; median_days: number | null }
export interface IncomeRow { month: string; income: number; expenses: number; cash_in: number; cash_out: number; net: number }
export interface BillingRow { month: string; district_id: string; district_so: string; district_en: string; fee_type: string; fee_name_so: string; fee_name_en: string; invoices: number; billed: number; collected: number; credited: number; outstanding: number }
export interface InvoiceRow { invoice_id: string; parcel_id: string | null; number: string; pun: string | null; district_so: string; district_en: string; fee_name_so: string; fee_name_en: string; period: string | null; issue_date: string; due_date: string; total: number; paid: number; balance: number; status: string }
export interface PaymentRow { payment_id: string; parcel_id: string | null; receipt_no: string; received_at: string; pun: string | null; invoices: string | null; method: string; cashier: string | null; point_of_sale: string | null; payer: string | null; amount: number; status: string }
export interface CertificateRow { document_id: string; parcel_id: string | null; serial: string; type: string; pun: string | null; owner: string | null; district_so: string | null; district_en: string | null; issued_at: string; issued_by: string | null; status: string }
export interface ParcelRow { parcel_id: string; pun: string | null; district_so: string; district_en: string; neighbourhood_so: string | null; neighbourhood_en: string | null; house_no: string | null; area_m2: number | null; land_use: string | null; grade_so: string | null; grade_en: string | null; status: string; provisional: boolean; owners: string | null; registered_at: string | null; created_at: string }
export interface LocationRow { level: "district" | "section" | "sector" | "neighbourhood"; code: string; name_so: string; name_en: string; district_so: string; district_en: string; parcels: number; registered: number; partial: number; has_boundary: boolean }
export interface OwnerRow { party_id: string; parcel_id: string; owner: string; phone: string | null; id_type: string | null; id_number: string | null; role: string; share_pct: number | null; pun: string | null; district_so: string; district_en: string; neighbourhood_so: string | null; neighbourhood_en: string | null; area_m2: number | null; status: string }
export interface AccountRow { code: string; name_so: string; name_en: string; type: string; debit: number; credit: number; net: number }

export async function accountTotals(from: string, to: string, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  return unwrap(await supabase.rpc("report_accounts", { p_from: from, p_to: to }), "report") as AccountRow[];
}

export interface CashierRow { cashier_id: string; cashier_name: string; shifts: number; payments: number; amount: number; difference: number }

/** Default range: the current year to date. Accepts ?from=&to= in ISO dates. */
export function reportRange(sp: Record<string, string | undefined>) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const from = iso.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = iso.test(sp.to ?? "") ? sp.to! : today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function parcelKind(v: string | undefined): ParcelKind {
  return (PARCEL_KINDS as readonly string[]).includes(v ?? "") ? (v as ParcelKind) : "all";
}
