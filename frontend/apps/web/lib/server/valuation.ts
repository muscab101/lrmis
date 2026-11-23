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

export interface TransferType {
  id: string;
  name_so: string;
  name_en: string;
  /** Which rules it follows: a court-order type needs the court's order. */
  works_as: "sale" | "gift" | "inheritance" | "court_order";
  /** Stamp duty charged when the transfer is sent for approval (USD). */
  duty: number;
  active: boolean;
  sort: number;
  /** How many transfers used it. */
  used: number;
}

export async function listTransferTypes() {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("transfer_types").select("id, name_so, name_en, works_as, duty, active, sort, transfers(count)").order("sort").order("name_en"),
    "transfer types",
  ) as unknown as (Omit<TransferType, "used"> & { transfers: { count: number }[] })[];
  return rows.map(({ transfers, ...r }) => ({ ...r, duty: Number(r.duty), used: transfers[0]?.count ?? 0 })) as TransferType[];
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

/** A neighbourhood that has prices of its own, for the Rates overview. */
export interface PricedNeighbourhood {
  id: string;
  code: string;
  name_so: string;
  name_en: string;
  district_code: string | null;
  prices: number;
  updated_at: string;
}

/** Every neighbourhood with prices of its own (newest change first). */
export async function listPricedNeighbourhoods() {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase
      .from("neighbourhood_grade_prices")
      .select("updated_at, neighbourhood:neighbourhoods(id, code, name_so, name_en, sector:sectors(section:sections(district:districts(code))))")
      .order("updated_at", { ascending: false })
      .limit(2000),
    "priced neighbourhoods",
  ) as unknown as {
    updated_at: string;
    neighbourhood: { id: string; code: string; name_so: string; name_en: string; sector: { section: { district: { code: string } | null } | null } | null } | null;
  }[];
  const by = new Map<string, PricedNeighbourhood>();
  for (const r of rows) {
    const n = r.neighbourhood;
    if (!n) continue;
    const cur = by.get(n.id);
    if (cur) cur.prices += 1;
    else by.set(n.id, { id: n.id, code: n.code, name_so: n.name_so, name_en: n.name_en, district_code: n.sector?.section?.district?.code ?? null, prices: 1, updated_at: r.updated_at });
  }
  return [...by.values()];
}

/** One neighbourhood's own prices, by house type id. */
export async function neighbourhoodPrices(neighbourhoodId: string) {
  const supabase = await createClient();
  const rows = unwrap(
    await supabase.from("neighbourhood_grade_prices").select("grade_id, amount").eq("neighbourhood_id", neighbourhoodId),
    "neighbourhood prices",
  ) as { grade_id: string; amount: number }[];
  return Object.fromEntries(rows.map((r) => [r.grade_id, Number(r.amount)])) as Record<string, number>;
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
  /** A storey building's upper storeys (counted in buildings_amount), e.g. "6 upper storeys × 144 m² × 0.20 USD per m² (Upper Floors)". */
  upper_storeys?: number;
  upper_storeys_amount?: number;
  upper_storeys_line?: string | null;
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

export interface BuildingType {
  id: string;
  name_so: string;
  name_en: string;
  /** What kind of land: one house, a block of flats, or a compound of several houses. */
  layout: "house" | "flats" | "compound";
  /** The house type (Valuation price) that bills it. */
  grade_code: string;
  active: boolean;
  sort: number;
}

/** Valuation → Building types: the land form's "Building type" choices. */
export async function listBuildingTypes(activeOnly = false) {
  const supabase = await createClient();
  let q = supabase.from("building_types").select("id, name_so, name_en, layout, grade_code, active, sort");
  if (activeOnly) q = q.eq("active", true);
  return unwrap(await q.order("sort").order("name_en"), "building types") as BuildingType[];
}
