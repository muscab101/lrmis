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
  tasks: Record<
    "surveys" | "transfers" | "permits" | "changes" | "disputes" | "campaigns" | "messages_failed",
    number
  >;
}

/** One job's waiting work on the dashboard ("My work"). */
export interface WorkPanel {
  panel: "surveyor" | "surveys" | "registration" | "cashier" | "collections" | "billing" | "valuation" | "legal" | "accounting" | "printing" | "admin";
  month_open?: boolean;
  items: { key: string; n: number; amount?: number }[];
}

/** The panels of the jobs the signed-in user does (by their powers), with what waits for them. */
export async function dashboardWork(): Promise<WorkPanel[]> {
  const supabase = await createClient();
  return (unwrap(await supabase.rpc("dashboard_work"), "dashboard work") ?? []) as WorkPanel[];
}

export async function dashboardKpis(): Promise<Kpis> {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("dashboard_kpis"), "dashboard") as Kpis;
}

/** Pair of figures: this period and the one before. */
export interface PeriodPair {
  cur: number;
  prev: number;
}
export interface DashboardPeriod {
  days: number;
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  applications?: PeriodPair;
  weekday?: number[];
  recent?: {
    id: string;
    number: string;
    status: string;
    created_at: string;
    district_en: string | null;
    district_so: string | null;
    owners: string | null;
  }[];
  registered?: PeriodPair & { total: number };
  owners?: PeriodPair & { total: number };
  collected?: PeriodPair;
  billed?: PeriodPair & { paid_cur: number; outstanding: number };
  series?: { day: string; collected: number; billed: number }[];
  by_fee?: { code: string; name_en: string; name_so: string; amount: number }[];
  districts?: { name_en: string; name_so: string; amount: number }[];
}

/** The dashboard's figures for the last `days` days next to the same length before. */
export async function dashboardPeriod(days: number): Promise<DashboardPeriod> {
  const supabase = await createClient();
  return unwrap(
    await supabase.rpc("dashboard_period", { p_days: days }),
    "dashboard period",
  ) as DashboardPeriod;
}

export const REPORTS = [
  "revenue",
  "billing",
  "invoices",
  "payments",
  "paymentTypes",
  "certificates",
  "parcels",
  "owners",
  "locations",
  "arrears",
  "collection",
  "income",
  "registrations",
  "cashiers",
  "collections",
  "collectionsCashier",
  "shortages",
  "unreconciled",
  "transfers",
  "permits",
  "disputes",
  "demolished",
  "surveyZones",
  "certificateStatus",
  "staffActivity",
  "messages",
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
  /** Payments only: way of paying and fee type code. */
  method?: PaymentMethodFilter | null;
  feeType?: string | null;
  /** Parcels only: all, registered or partial (not yet registered). */
  kind?: ParcelKind;
  /** Collections reports: group by day, week (Mon–Sun) or month; count verified payments only or everything recorded. */
  by?: CollectionBy;
  basis?: CollectionBasis;
  /** Money reports (POS_REPORTS): one point of sale. */
  pos?: string | null;
  /** Revenue: the payments' check status and the bills' status; summary (month × fee) or one line per payment. */
  checkStatus?: CheckStatus | null;
  billStatus?: BillStatus | null;
  view?: RevenueView;
}

/** Reports that can be narrowed to one point of sale. */
export const POS_REPORTS: readonly ReportName[] = [
  "payments",
  "collections",
  "collectionsCashier",
  "unreconciled",
];

export const COLLECTION_BY = ["day", "week", "month"] as const;
export type CollectionBy = (typeof COLLECTION_BY)[number];
export const COLLECTION_BASIS = ["verified", "all"] as const;
export type CollectionBasis = (typeof COLLECTION_BASIS)[number];
/** Reports that count verified payments by default (or all recorded ones). */
export const BASIS_REPORTS: readonly ReportName[] = [
  "collections",
  "collectionsCashier",
  "paymentTypes",
];
/** Reports that carry the verification and approval facts and the previous-period comparison. */
export const FINANCE_REPORTS: readonly ReportName[] = [
  "collections",
  "collectionsCashier",
  "paymentTypes",
  "shortages",
  "unreconciled",
];

export const collectionBy = (v: string | undefined): CollectionBy =>
  (COLLECTION_BY as readonly string[]).includes(v ?? "") ? (v as CollectionBy) : "day";
export const collectionBasis = (v: string | undefined): CollectionBasis =>
  v === "all" ? "all" : "verified";

/** Revenue report filters: a payment's check state, a bill's state, and summary or detail. */
export const CHECK_STATUSES = ["verified", "reconciled", "pending", "disputed"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const BILL_STATUSES = ["paid", "partially_paid", "issued"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export const REVENUE_VIEWS = ["summary", "detail"] as const;
export type RevenueView = (typeof REVENUE_VIEWS)[number];
export const checkStatus = (v: string | undefined): CheckStatus | null =>
  (CHECK_STATUSES as readonly string[]).includes(v ?? "") ? (v as CheckStatus) : null;
export const billStatus = (v: string | undefined): BillStatus | null =>
  (BILL_STATUSES as readonly string[]).includes(v ?? "") ? (v as BillStatus) : null;
export const revenueView = (v: string | undefined): RevenueView =>
  v === "detail" ? "detail" : "summary";

/** Ways of paying the Payments report filters by; mobile money is any wallet; "other" is cheques and the rest. Card is Visa / Mastercard. */
export const PAYMENT_METHODS = [
  "cash",
  "evc_plus",
  "edahab",
  "zaad",
  "mobile_money",
  "bank_transfer",
  "card",
  "other",
] as const;
export type PaymentMethodFilter = (typeof PAYMENT_METHODS)[number];

export function paymentMethod(v: string | undefined): PaymentMethodFilter | null {
  return (PAYMENT_METHODS as readonly string[]).includes(v ?? "")
    ? (v as PaymentMethodFilter)
    : null;
}

/** A fee type code from ?fee= (letters, digits and underscores). */
export function feeTypeCode(v: string | undefined) {
  return v && /^[a-z0-9_]{1,40}$/.test(v) ? v : null;
}

export const PARCEL_KINDS = ["all", "registered", "partial"] as const;
export type ParcelKind = (typeof PARCEL_KINDS)[number];

/** Reports that list what exists now rather than what happened in a period. */
export const SNAPSHOT_REPORTS: readonly ReportName[] = [
  "arrears",
  "parcels",
  "owners",
  "locations",
  "surveyZones",
  "certificateStatus",
];
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
  "paymentTypes",
  "certificates",
  "parcels",
  "owners",
  "locations",
  "collections",
  "collectionsCashier",
  "shortages",
  "unreconciled",
  "transfers",
  "permits",
  "disputes",
  "demolished",
  "surveyZones",
  "certificateStatus",
  "staffActivity",
  "messages",
];
/** Reports that also take a section, sector and neighbourhood filter. */
export const AREA_REPORTS: readonly ReportName[] = DISTRICT_REPORTS.filter(
  (r) => !["income", "shortages", "staffActivity", "messages"].includes(r),
);
/** Reports only people who can see the activity log are offered. */
export const AUDIT_REPORTS: readonly ReportName[] = ["staffActivity"];

/** Reports grouped by what they are about, in the order the page shows them. */
export const REPORT_GROUPS: {
  key: "collections" | "money" | "land" | "cases" | "documents" | "staff";
  reports: ReportName[];
}[] = [
  {
    key: "collections",
    reports: ["collections", "collectionsCashier", "paymentTypes", "shortages", "unreconciled"],
  },
  {
    key: "money",
    reports: [
      "revenue",
      "billing",
      "invoices",
      "payments",
      "arrears",
      "collection",
      "income",
      "cashiers",
    ],
  },
  {
    key: "land",
    reports: ["parcels", "owners", "locations", "registrations", "surveyZones", "demolished"],
  },
  { key: "cases", reports: ["transfers", "permits", "disputes"] },
  { key: "documents", reports: ["certificates", "certificateStatus"] },
  { key: "staff", reports: ["staffActivity", "messages"] },
];

/** Reports about the same things, offered as next steps from each report (filters carry over). */
export const RELATED_REPORTS: Record<ReportName, ReportName[]> = {
  revenue: ["collections", "paymentTypes", "payments", "billing", "income"],
  billing: ["invoices", "collection", "arrears"],
  invoices: ["payments", "billing", "arrears"],
  payments: ["paymentTypes", "invoices", "revenue", "cashiers"],
  paymentTypes: ["collections", "collectionsCashier", "payments", "revenue"],
  arrears: ["invoices", "collection"],
  collection: ["billing", "invoices", "arrears"],
  income: ["revenue", "payments"],
  cashiers: ["collectionsCashier", "shortages", "payments"],
  collections: ["collectionsCashier", "paymentTypes", "unreconciled", "billing"],
  collectionsCashier: ["shortages", "collections", "unreconciled", "cashiers"],
  shortages: ["collectionsCashier", "unreconciled", "cashiers"],
  unreconciled: ["shortages", "collectionsCashier", "payments"],
  parcels: ["owners", "locations", "certificateStatus", "invoices"],
  owners: ["parcels", "certificates", "transfers"],
  locations: ["parcels", "surveyZones", "owners"],
  registrations: ["parcels", "surveyZones", "certificates"],
  certificates: ["certificateStatus", "parcels", "owners"],
  transfers: ["owners", "certificates", "disputes"],
  permits: ["parcels", "demolished", "invoices"],
  disputes: ["transfers", "parcels"],
  demolished: ["parcels", "permits"],
  surveyZones: ["locations", "registrations", "staffActivity"],
  certificateStatus: ["certificates", "arrears", "invoices"],
  staffActivity: ["cashiers", "surveyZones", "certificates"],
  messages: ["certificates", "payments"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** District, section, sector and neighbourhood from ?district=&section=&sector=&nbhd= (ids only). */
export function reportArea(sp: Record<string, string | undefined>) {
  const id = (v: string | undefined) => (v && UUID.test(v) ? v : null);
  return {
    district: id(sp.district),
    section: id(sp.section),
    sector: id(sp.sector),
    neighbourhood: id(sp.nbhd),
  };
}

/** Runs one report RPC. The functions check `reports.view` and district access themselves. */
export async function runReport(name: ReportName, args: ReportArgs, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  const d = args.district || null;
  const area = {
    p_section: args.section || null,
    p_sector: args.sector || null,
    p_neighbourhood: args.neighbourhood || null,
  };
  switch (name) {
    case "revenue": {
      const status = {
        p_check_status: args.checkStatus ?? null,
        p_bill_status: args.billStatus ?? null,
      };
      if (args.view === "detail")
        return unwrap(
          await supabase.rpc("report_revenue_detail", {
            p_from: args.from,
            p_to: args.to,
            p_district: d,
            ...area,
            ...status,
          }),
          "report",
        ) as RevenueDetailRow[];
      return unwrap(
        await supabase.rpc("report_revenue", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
          ...status,
        }),
        "report",
      ) as RevenueRow[];
    }
    case "arrears":
      return unwrap(
        await supabase.rpc("report_arrears", { p_district: d, ...area }),
        "report",
      ) as ArrearsRow[];
    case "collection":
      return unwrap(
        await supabase.rpc("report_collection", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
        }),
        "report",
      ) as CollectionRow[];
    case "registrations":
      return unwrap(
        await supabase.rpc("report_registrations", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
        }),
        "report",
      ) as RegistrationRow[];
    case "income":
      return unwrap(
        await supabase.rpc("report_income_expense", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
        }),
        "report",
      ) as IncomeRow[];
    case "cashiers":
      return unwrap(
        await supabase.rpc("report_cashiers", { p_from: args.from, p_to: args.to }),
        "report",
      ) as CashierRow[];
    case "billing":
      return unwrap(
        await supabase.rpc("report_billing", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
        }),
        "report",
      ) as BillingRow[];
    case "invoices":
      return unwrap(
        await supabase.rpc("report_invoices", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
        }),
        "report",
      ) as InvoiceRow[];
    case "payments":
      return unwrap(
        await supabase.rpc("report_payments", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
          p_method: args.method ?? null,
          p_fee_type: args.feeType ?? null,
          p_pos: args.pos ?? null,
        }),
        "report",
      ) as PaymentRow[];
    case "paymentTypes":
      return unwrap(
        await supabase.rpc("report_payment_types", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
          p_basis: args.basis ?? "verified",
        }),
        "report",
      ) as PaymentTypeRow[];
    case "collections":
      return unwrap(
        await supabase.rpc("report_collections", {
          p_from: args.from,
          p_to: args.to,
          p_by: args.by ?? "day",
          p_basis: args.basis ?? "verified",
          p_district: d,
          ...area,
          p_pos: args.pos ?? null,
        }),
        "report",
      ) as CollectionsRow[];
    case "collectionsCashier":
      return unwrap(
        await supabase.rpc("report_collections_cashier", {
          p_from: args.from,
          p_to: args.to,
          p_basis: args.basis ?? "verified",
          p_district: d,
          ...area,
          p_pos: args.pos ?? null,
        }),
        "report",
      ) as CollectionsCashierRow[];
    case "shortages":
      return unwrap(
        await supabase.rpc("report_cashier_shortages", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
        }),
        "report",
      ) as ShortageRow[];
    case "unreconciled":
      return unwrap(
        await supabase.rpc("report_unreconciled", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
          p_pos: args.pos ?? null,
        }),
        "report",
      ) as UnreconciledRow[];
    case "certificates":
      return unwrap(
        await supabase.rpc("report_certificates", {
          p_from: args.from,
          p_to: args.to,
          p_district: d,
          ...area,
        }),
        "report",
      ) as CertificateRow[];
    case "parcels":
      return unwrap(
        await supabase.rpc("report_parcels", {
          p_district: d,
          p_kind: args.kind ?? "all",
          ...area,
        }),
        "report",
      ) as ParcelRow[];
    case "owners":
      return unwrap(
        await supabase.rpc("report_owners", { p_district: d, ...area }),
        "report",
      ) as OwnerRow[];
    case "locations":
      return unwrap(
        await supabase.rpc("report_locations", { p_district: d, ...area }),
        "report",
      ) as LocationRow[];
    case "transfers":
    case "permits":
    case "disputes":
    case "demolished":
      return unwrap(
        await supabase.rpc(`report_${name}`, { p_from: args.from, p_to: args.to, p_district: d, ...area }),
        "report",
      ) as TransferRow[] | PermitRow[] | DisputeRow[] | DemolishedRow[];
    case "surveyZones":
      return unwrap(
        await supabase.rpc("report_survey_zones", { p_district: d, ...area }),
        "report",
      ) as SurveyZoneRow[];
    case "certificateStatus":
      return unwrap(
        await supabase.rpc("report_certificate_status", { p_district: d, ...area }),
        "report",
      ) as CertificateStatusRow[];
    case "staffActivity":
      return unwrap(
        await supabase.rpc("report_staff_activity", { p_from: args.from, p_to: args.to, p_district: d }),
        "report",
      ) as StaffActivityRow[];
    case "messages":
      return unwrap(
        await supabase.rpc("report_messages", { p_from: args.from, p_to: args.to, p_district: d }),
        "report",
      ) as MessageRow[];
  }
}

export interface RevenueRow {
  month: string;
  fee_type: string;
  fee_name_so: string;
  fee_name_en: string;
  amount: number;
  payments: number;
}
export interface RevenueDetailRow {
  received_at: string;
  receipt_no: string;
  pun: string | null;
  payer: string | null;
  fee_type: string;
  fee_name_so: string;
  fee_name_en: string;
  invoice_number: string | null;
  bill_status: string | null;
  check_status: string;
  channel: string;
  amount: number;
}
export interface ArrearsRow {
  district_id: string;
  district_so: string;
  district_en: string;
  invoices: number;
  not_due: number;
  d1_30: number;
  d31_90: number;
  d91_180: number;
  d180: number;
  total: number;
}
export interface CollectionRow {
  district_id: string;
  district_so: string;
  district_en: string;
  invoices: number;
  billed: number;
  collected: number;
  credited: number;
  outstanding: number;
  rate: number;
}
export interface RegistrationRow {
  month: string;
  submitted: number;
  registered: number;
  rejected: number;
  median_days: number | null;
}
export interface IncomeRow {
  month: string;
  income: number;
  expenses: number;
  cash_in: number;
  cash_out: number;
  net: number;
}
export interface BillingRow {
  month: string;
  district_id: string;
  district_so: string;
  district_en: string;
  fee_type: string;
  fee_name_so: string;
  fee_name_en: string;
  invoices: number;
  billed: number;
  collected: number;
  credited: number;
  outstanding: number;
}
export interface InvoiceRow {
  invoice_id: string;
  parcel_id: string | null;
  number: string;
  pun: string | null;
  district_so: string;
  district_en: string;
  fee_name_so: string;
  fee_name_en: string;
  period: string | null;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}
export interface PaymentRow {
  payment_id: string;
  parcel_id: string | null;
  receipt_no: string;
  received_at: string;
  pun: string | null;
  invoices: string | null;
  fee_types_so: string | null;
  fee_types_en: string | null;
  method: string;
  cashier: string | null;
  point_of_sale: string | null;
  payer: string | null;
  amount: number;
  status: string;
}
type ChannelAmounts = {
  cash: number;
  evc_plus: number;
  edahab: number;
  zaad: number;
  bank_transfer: number;
  card: number;
  other: number;
  total: number;
};
export interface PaymentTypeRow extends ChannelAmounts {
  fee_type: string;
  fee_name_so: string;
  fee_name_en: string;
  payments: number;
}
export interface CollectionsRow extends ChannelAmounts {
  period: string;
  period_end: string;
  payments: number;
}
export interface CollectionsCashierRow extends ChannelAmounts {
  cashier_id: string | null;
  cashier: string;
  payments: number;
  unchecked: number;
  days: number;
  reconciled_days: number;
  shortage: number;
  excess: number;
}
export interface ShortageRow {
  reconciliation_id: string;
  number: string;
  business_date: string;
  cashier_id: string;
  cashier: string | null;
  recorded: number;
  actual: number;
  cash: number;
  evc_plus: number;
  edahab: number;
  zaad: number;
  bank_transfer: number;
  card: number;
  other: number;
  difference: number;
  shortage: number;
  excess: number;
  status: string;
  prepared_by: string | null;
  approved_by: string | null;
  decided_at: string | null;
}
export interface UnreconciledRow {
  payment_id: string;
  parcel_id: string | null;
  receipt_no: string;
  received_at: string;
  cashier: string;
  channel: string;
  reference: string | null;
  pun: string | null;
  amount: number;
  verify_status: string;
  age_days: number;
  dispute_reason: string | null;
}

export interface CollectionsCompareRow {
  channel: string;
  current_amount: number;
  previous_amount: number;
  current_count: number;
  previous_count: number;
  previous_from: string;
  previous_to: string;
}
export interface CollectionsStatus {
  pending: { n: number; amount: number };
  verified: { n: number; amount: number };
  reconciled: { n: number; amount: number };
  disputed: { n: number; amount: number };
  approved: number;
  waiting: number;
  approvers: string;
  last_approved_at: string | null;
}

/** This period against the same number of days just before it, per way of paying. */
export async function collectionsCompare(args: ReportArgs, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  const rows = unwrap(
    await supabase.rpc("report_collections_compare", {
      p_from: args.from,
      p_to: args.to,
      p_basis: args.basis ?? "verified",
      p_district: args.district || null,
      p_section: args.section || null,
      p_sector: args.sector || null,
      p_neighbourhood: args.neighbourhood || null,
      p_pos: args.pos || null,
    }),
    "compare",
  ) as CollectionsCompareRow[];
  return rows.map((r) => ({
    ...r,
    current_amount: Number(r.current_amount),
    previous_amount: Number(r.previous_amount),
    current_count: Number(r.current_count),
    previous_count: Number(r.previous_count),
  }));
}

/** How much of the period is verified, pending, disputed or reconciled, and the reconciliation approvals. */
export async function collectionsStatus(args: ReportArgs, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  return unwrap(
    await supabase.rpc("report_collections_status", {
      p_from: args.from,
      p_to: args.to,
      p_district: args.district || null,
      p_section: args.section || null,
      p_sector: args.sector || null,
      p_neighbourhood: args.neighbourhood || null,
      p_pos: args.pos || null,
    }),
    "collections status",
  ) as CollectionsStatus;
}
export interface CertificateRow {
  document_id: string;
  parcel_id: string | null;
  serial: string;
  type: string;
  pun: string | null;
  owner: string | null;
  district_so: string | null;
  district_en: string | null;
  issued_at: string;
  issued_by: string | null;
  status: string;
}
export interface ParcelRow {
  parcel_id: string;
  pun: string | null;
  district_so: string;
  district_en: string;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  house_no: string | null;
  area_m2: number | null;
  land_use: string | null;
  grade_so: string | null;
  grade_en: string | null;
  status: string;
  provisional: boolean;
  owners: string | null;
  registered_at: string | null;
  created_at: string;
}
export interface LocationRow {
  level: "district" | "section" | "sector" | "neighbourhood";
  code: string;
  name_so: string;
  name_en: string;
  district_so: string;
  district_en: string;
  parcels: number;
  registered: number;
  partial: number;
  has_boundary: boolean;
}
export interface OwnerRow {
  party_id: string;
  parcel_id: string;
  owner: string;
  phone: string | null;
  id_type: string | null;
  id_number: string | null;
  role: string;
  share_pct: number | null;
  pun: string | null;
  district_so: string;
  district_en: string;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  area_m2: number | null;
  status: string;
}
export interface AccountRow {
  code: string;
  name_so: string;
  name_en: string;
  type: string;
  debit: number;
  credit: number;
  net: number;
}

export async function accountTotals(from: string, to: string, client?: SupabaseClient) {
  const supabase = client ?? (await createClient());
  return unwrap(
    await supabase.rpc("report_accounts", { p_from: from, p_to: to }),
    "report",
  ) as AccountRow[];
}

export interface CashierRow {
  cashier_id: string;
  cashier_name: string;
  shifts: number;
  payments: number;
  amount: number;
  difference: number;
}

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

export interface TransferRow {
  transfer_id: string;
  parcel_id: string | null;
  number: string;
  pun: string | null;
  kind: string;
  from_owners: string | null;
  to_owners: string | null;
  declared_value: number | null;
  district_so: string;
  district_en: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  status: string;
  duty_balance: number | null;
}
export interface PermitRow {
  permit_id: string;
  parcel_id: string | null;
  number: string;
  pun: string | null;
  kind: string;
  applicant: string | null;
  phone: string | null;
  floors: number | null;
  area_m2: number | null;
  district_so: string;
  district_en: string;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  status: string;
  valid_until: string | null;
}
export interface DisputeRow {
  dispute_id: string;
  parcel_id: string | null;
  number: string;
  pun: string | null;
  kind: string;
  claimant: string | null;
  court_case_no: string | null;
  district_so: string;
  district_en: string;
  opened_at: string;
  resolved_at: string | null;
  days_open: number;
  status: string;
  resolution: string | null;
}
export interface DemolishedRow {
  demolition_id: string;
  parcel_id: string | null;
  number: string;
  pun: string | null;
  house_no: string | null;
  owners: string | null;
  district_so: string;
  district_en: string;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  demolition_date: string;
  reason: string | null;
  status: string;
  rebuilt: boolean;
}
export interface SurveyZoneRow {
  zone_id: string;
  code: string;
  name_so: string;
  name_en: string;
  district_so: string;
  district_en: string;
  surveyor: string | null;
  target: number;
  recorded: number;
  partial: number;
  registered: number;
  pct: number | null;
  owners_waiting: number;
  assigned_at: string;
  status: string;
}
export interface CertificateStatusRow {
  parcel_id: string;
  pun: string | null;
  owner: string | null;
  phone: string | null;
  district_so: string;
  district_en: string;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  serial: string | null;
  issued_at: string | null;
  expires_at: string | null;
  cert_status: "valid" | "expired" | "cancelled" | "none";
  owing: number;
}
export interface StaffActivityRow {
  user_id: string;
  staff: string;
  role: string | null;
  parcels_added: number;
  parcels_registered: number;
  payments: number;
  payments_amount: number;
  certificates: number;
  decisions: number;
  changes: number;
  last_active: string | null;
}
export interface MessageRow {
  template_code: string;
  channel: string;
  total: number;
  sent: number;
  waiting: number;
  failed: number;
  cancelled: number;
  rate: number | null;
}
