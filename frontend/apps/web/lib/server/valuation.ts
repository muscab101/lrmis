import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface Grade {
  id: string;
  code: string;
  name_so: string;
  name_en: string;
  amount: number;
  active: boolean;
  sort: number;
}
export interface FeeType extends Grade {
  interval: "monthly" | "quarterly" | "biannual" | "annual" | "one_off";
}

export async function listGrades() {
  const supabase = await createClient();
  return unwrap(await supabase.from("property_grades").select("id, code, name_so, name_en, amount, active, sort").order("sort"), "grades") as Grade[];
}

export async function listFeeTypes() {
  const supabase = await createClient();
  return unwrap(await supabase.from("fee_types").select("id, code, name_so, name_en, interval, amount, active, sort").order("sort"), "fee types") as FeeType[];
}

export interface OwnerType {
  id: string;
  name_so: string;
  name_en: string;
  active: boolean;
  sort: number;
  owners: number;
}

export async function listOwnerTypes() {
  const supabase = await createClient();
  const rows = unwrap(await supabase.from("owner_types").select("id, name_so, name_en, active, sort, parties(count)").order("sort").order("name_en"), "owner types") as unknown as (Omit<OwnerType, "owners"> & {
    parties: { count: number }[];
  })[];
  return rows.map(({ parties, ...r }) => ({ ...r, owners: parties[0]?.count ?? 0 })) as OwnerType[];
}

export interface RateRow {
  id: string;
  land_use: string;
  developed: boolean;
  rate_m2: number;
  service_charge: number;
  valid_from: string;
  note: string | null;
  created_at: string;
  neighbourhood: { id: string; code: string; name_so: string; name_en: string } | null;
}

export async function listRates(neighbourhoodId: string | null) {
  const supabase = await createClient();
  let req = supabase
    .from("neighbourhood_rates")
    .select("id, land_use, developed, rate_m2, service_charge, valid_from, note, created_at, neighbourhood:neighbourhoods(id, code, name_so, name_en)");
  if (neighbourhoodId) req = req.eq("neighbourhood_id", neighbourhoodId);
  const res = await req.order("valid_from", { ascending: false }).order("land_use").limit(200);
  return unwrap(res, "rates") as unknown as RateRow[];
}

export interface AssessmentRow {
  id: string;
  number: string;
  year: number;
  total: number;
  status: "issued" | "superseded";
  created_at: string;
  override_note: string | null;
  parcel: { id: string; pun: string | null } | null;
}

export async function listAssessments(opts: { year: number | null; q: string; status: "issued" | "any" }) {
  const supabase = await createClient();
  let req = supabase.from("assessments").select("id, number, year, total, status, created_at, override_note, parcel:parcels(id, pun)");
  if (opts.year) req = req.eq("year", opts.year);
  if (opts.status === "issued") req = req.eq("status", "issued");
  const term = opts.q.replace(/[,()*%\\]/g, " ").trim();
  if (term) req = req.ilike("number", `%${term}%`);
  const res = await req.order("created_at", { ascending: false }).limit(100);
  return unwrap(res, "assessments") as unknown as AssessmentRow[];
}

export interface ExemptionRow {
  id: string;
  kind: string;
  pct: number;
  reason: string;
  valid_from: string;
  valid_to: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
  parcel: { id: string; pun: string | null } | null;
}

export async function listExemptions(status: "pending" | "any") {
  const supabase = await createClient();
  let req = supabase.from("exemptions").select("id, kind, pct, reason, valid_from, valid_to, status, requested_by, requested_at, decision_note, parcel:parcels(id, pun)");
  if (status === "pending") req = req.eq("status", "pending");
  return unwrap(await req.order("requested_at", { ascending: false }).limit(100), "exemptions") as unknown as ExemptionRow[];
}

export interface AppealRow {
  id: string;
  reason: string;
  requested_total: number | null;
  status: "open" | "upheld" | "rejected" | "withdrawn";
  filed_by: string | null;
  filed_at: string;
  decision_note: string | null;
  assessment: { id: string; number: string; year: number; total: number } | null;
  parcel: { id: string; pun: string | null } | null;
}

export async function listAppeals(status: "open" | "any") {
  const supabase = await createClient();
  let req = supabase
    .from("appeals")
    .select(
      "id, reason, requested_total, status, filed_by, filed_at, decision_note, assessment:assessments!appeals_assessment_id_fkey(id, number, year, total), parcel:parcels(id, pun)",
    );
  if (status === "open") req = req.eq("status", "open");
  return unwrap(await req.order("filed_at", { ascending: false }).limit(100), "appeals") as unknown as AppealRow[];
}

export async function valuationCounts(): Promise<{ assessments: number; exemptions_pending: number; appeals_open: number }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("valuation_counts");
  return (data as { assessments: number; exemptions_pending: number; appeals_open: number } | null) ?? { assessments: 0, exemptions_pending: 0, appeals_open: 0 };
}

export interface ParcelValuation {
  buildings: { id: string; units: number; floors: number; area_m2: number | null; use: string | null; note: string | null; grade: { id: string; code: string; name_so: string; name_en: string; amount: number } | null }[];
  assessments: (AssessmentRow & { breakdown: Breakdown; land_amount: number; buildings_amount: number; exemption_amount: number; service_charge: number })[];
  exemptions: ExemptionRow[];
  appeals: AppealRow[];
}

export interface Breakdown {
  year: number;
  area_m2: number;
  rate_m2: number;
  /** property_type: the property type's rate, the same sum as the bill. */
  rate_source: "default" | "neighbourhood" | "property_type";
  property_type_so?: string | null;
  property_type_en?: string | null;
  rate_valid_from: string | null;
  land_amount: number;
  buildings: { grade: string; grade_so: string; grade_en: string; units: number; amount: number; line: number }[];
  buildings_amount: number;
  exemption_kind: string | null;
  exemption_pct: number;
  exemption_amount: number;
  service_charge: number;
  total: number;
}

export async function getParcelValuation(parcelId: string): Promise<ParcelValuation> {
  const supabase = await createClient();
  const [b, a, e, ap] = await Promise.all([
    supabase.from("buildings").select("id, units, floors, area_m2, use, note, grade:property_grades(id, code, name_so, name_en, amount)").eq("parcel_id", parcelId).order("created_at"),
    supabase
      .from("assessments")
      .select("id, number, year, total, status, created_at, override_note, breakdown, land_amount, buildings_amount, exemption_amount, service_charge, parcel:parcels(id, pun)")
      .eq("parcel_id", parcelId)
      .order("year", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("exemptions").select("id, kind, pct, reason, valid_from, valid_to, status, requested_by, requested_at, decision_note, parcel:parcels(id, pun)").eq("parcel_id", parcelId).order("requested_at", { ascending: false }),
    supabase
      .from("appeals")
      .select("id, reason, requested_total, status, filed_by, filed_at, decision_note, assessment:assessments!appeals_assessment_id_fkey(id, number, year, total), parcel:parcels(id, pun)")
      .eq("parcel_id", parcelId)
      .order("filed_at", { ascending: false }),
  ]);
  return {
    buildings: (b.data ?? []) as unknown as ParcelValuation["buildings"],
    assessments: (a.data ?? []) as unknown as ParcelValuation["assessments"],
    exemptions: (e.data ?? []) as unknown as ExemptionRow[],
    appeals: (ap.data ?? []) as unknown as AppealRow[],
  };
}
