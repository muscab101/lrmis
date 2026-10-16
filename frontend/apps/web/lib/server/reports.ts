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

export const REPORTS = ["revenue", "arrears", "collection", "registrations", "cashiers"] as const;
export type ReportName = (typeof REPORTS)[number];

export interface ReportArgs {
  from: string;
  to: string;
  district?: string | null;
}

/** Runs one report RPC. The functions check `reports.view` and district access themselves. */
export async function runReport(name: ReportName, args: ReportArgs, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  const d = args.district || null;
  switch (name) {
    case "revenue":
      return unwrap(await supabase.rpc("report_revenue", { p_from: args.from, p_to: args.to, p_district: d }), "report") as RevenueRow[];
    case "arrears":
      return unwrap(await supabase.rpc("report_arrears", { p_district: d }), "report") as ArrearsRow[];
    case "collection":
      return unwrap(await supabase.rpc("report_collection", { p_from: args.from, p_to: args.to }), "report") as CollectionRow[];
    case "registrations":
      return unwrap(await supabase.rpc("report_registrations", { p_from: args.from, p_to: args.to, p_district: d }), "report") as RegistrationRow[];
    case "cashiers":
      return unwrap(await supabase.rpc("report_cashiers", { p_from: args.from, p_to: args.to }), "report") as CashierRow[];
  }
}

export interface RevenueRow { month: string; fee_type: string; fee_name_so: string; fee_name_en: string; amount: number; payments: number }
export interface ArrearsRow { district_id: string; district_so: string; district_en: string; invoices: number; not_due: number; d1_30: number; d31_90: number; d91_180: number; d180: number; total: number }
export interface CollectionRow { district_id: string; district_so: string; district_en: string; invoices: number; billed: number; collected: number; credited: number; outstanding: number; rate: number }
export interface RegistrationRow { month: string; submitted: number; registered: number; rejected: number; median_days: number | null }
export interface CashierRow { cashier_id: string; cashier_name: string; shifts: number; payments: number; amount: number; difference: number }

/** Default range: the current year to date. Accepts ?from=&to= in ISO dates. */
export function reportRange(sp: Record<string, string | undefined>) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const from = iso.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = iso.test(sp.to ?? "") ? sp.to! : today;
  return from <= to ? { from, to } : { from: to, to: from };
}
