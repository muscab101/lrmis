import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { PARTY_COLUMNS, type PartyRow, type SiteCheckStatus } from "./applications";

export type ParcelStatus = "draft" | "surveyed" | "verified" | "registered" | "disputed" | "archived";

export interface ParcelListRow {
  id: string;
  pun: string | null;
  status: ParcelStatus;
  area_m2: number | null;
  district: string;
  neighbourhood: string | null;
  owners: string | null;
  created_at: string;
  house_no: string | null;
  govt_receipt_no: string | null;
  /** The latest open invoice (else the latest paid one) and what's still owed. */
  invoice: string | null;
  balance: number;
  locked_at: string | null;
  lock_reason: string | null;
  application_number: string | null;
  district_en: string;
  neighbourhood_en: string | null;
  plot_no: string | null;
}

export const PARCEL_STAGES = ["draft", "registered", "paid", "owing", "all"] as const;
/**
 * The tabs on Parcels: partial registration, registered, and registered land split by its bills — paid (nothing
 * owed) and not paid ("all" is only used inside, e.g. a zone's houses).
 */
export const PARCEL_TABS = ["draft", "registered", "paid", "owing"] as const;
export type ParcelStage = (typeof PARCEL_STAGES)[number];
/** Not registered yet: partial registration, still worked on through its application. */
const PARTIAL = "(draft,surveyed,verified)";

export async function searchParcels(q: string, stage: ParcelStage = "all", neighbourhoodId: string | null = null) {
  const supabase = await createClient();
  let req = supabase.rpc("search_parcels", { p_q: q.replace(/[%\\]/g, " ").trim(), p_limit: 1000 });
  if (neighbourhoodId) {
    const { data } = await supabase.from("parcels").select("id").eq("neighbourhood_id", neighbourhoodId).is("deleted_at", null).limit(1000);
    const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
    req = req.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (stage === "draft") req = req.in("status", ["draft", "surveyed", "verified"]);
  if (stage === "registered" || stage === "paid" || stage === "owing") req = req.not("status", "in", PARTIAL);
  if (stage === "paid") req = req.lte("balance", 0);
  if (stage === "owing") req = req.gt("balance", 0);
  const res = await req.limit(100);
  return unwrap(res, "parcels") as ParcelListRow[];
}

export interface ParcelDetail {
  developed: boolean;
  id: string;
  pun: string | null;
  account_no: string | null;
  status: ParcelStatus;
  land_use: string;
  ownership: string;
  area_m2: number | null;
  perimeter_m: number | null;
  plot_no: string | null;
  deed_no: string | null;
  govt_file_no: string | null;
  flat_no: string | null;
  house_no: string | null;
  govt_receipt_no: string | null;
  property_type: string | null;
  locked_at: string | null;
  lock_reason: string | null;
  registered_at: string | null;
  geom: GeoJSON.Polygon;
  application_id: string | null;
  application: { id: string; number: string } | null;
  /** Check if it exists: pending while a surveyor goes; confirmed or not_found once answered. */
  site_check_status: "pending" | "confirmed" | "not_found" | null;
  site_check_surveyor: string | null;
  site_check_requested_at: string | null;
  site_check_done_at: string | null;
  site_check_note: string | null;
  district: { code: string; name_so: string; name_en: string } | null;
  neighbourhood: { code: string; name_so: string; name_en: string } | null;
  parcel_owners: { id: string; role: string; share_pct: number | null; valid_from: string; valid_to: string | null; party: PartyRow }[];
  parcel_history: { id: number; action: string; note: string | null; at: string }[];
}

export async function getParcel(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("parcels")
    .select(
      `id, pun, account_no, status, land_use, ownership, developed, area_m2, perimeter_m, plot_no, deed_no, govt_file_no, house_no, flat_no, govt_receipt_no, property_type, locked_at, lock_reason, registered_at, geom, application_id,
       site_check_status, site_check_surveyor, site_check_requested_at, site_check_done_at, site_check_note,
       application:applications!parcels_application_id_fkey(id, number),
       district:districts(code, name_so, name_en), neighbourhood:neighbourhoods(code, name_so, name_en),
       parcel_owners(id, role, share_pct, valid_from, valid_to, party:parties(${PARTY_COLUMNS})),
       parcel_history(id, action, note, at)`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const parcel = unwrap(res, "parcel") as unknown as ParcelDetail | null;
  if (parcel) parcel.parcel_history.sort((a, b) => b.id - a.id);
  return parcel;
}

/** Parcel counts for the stage tabs (RLS: only districts the viewer can see). */
export async function parcelStageCounts(): Promise<Record<ParcelStage, number>> {
  const supabase = await createClient();
  const base = () => supabase.from("parcels").select("id", { count: "exact", head: true }).is("deleted_at", null).neq("status", "archived");
  // Registered land owing: from its open bills (RLS keeps both to the viewer's districts and registered-land access).
  const [draft, registered, owingRows] = await Promise.all([
    base().in("status", ["draft", "surveyed", "verified"]),
    base().not("status", "in", PARTIAL),
    supabase.rpc("search_parcels", { p_q: "", p_limit: 5000 }).not("status", "in", PARTIAL).gt("balance", 0).select("id"),
  ]);
  const owing = ((owingRows.data ?? []) as unknown[]).length;
  const reg = registered.count ?? 0;
  return { draft: draft.count ?? 0, registered: reg, paid: Math.max(reg - owing, 0), owing, all: (draft.count ?? 0) + reg };
}

export interface NeighbourhoodStatusRow {
  id: string;
  code: string;
  name_so: string;
  name_en: string;
  district_id: string;
  district_so: string;
  district_en: string;
  has_boundary: boolean;
  partial: number;
  open_applications: number;
  registered: number;
}

/** Per neighbourhood: land waiting (partial parcels, open applications) and land registered. */
export async function neighbourhoodStatus(districtId: string | null) {
  const supabase = await createClient();
  const res = await supabase.rpc("neighbourhood_registration_status", { p_district: districtId });
  return (unwrap(res, "neighbourhoods") as NeighbourhoodStatusRow[]).map((r) => ({
    ...r,
    partial: Number(r.partial),
    open_applications: Number(r.open_applications),
    registered: Number(r.registered),
  }));
}

export interface ParcelApplicationRow {
  id: string;
  number: string;
  status: ApplicationStatus;
  created_by: string | null;
  land_use: string | null;
  site_check_status: SiteCheckStatus | null;
  site_check_surveyor: string | null;
}

/** The applications behind partial parcels, so their work (edit, site check, register, delete) runs from Parcels. */
export async function applicationsByNumber(numbers: string[]) {
  if (numbers.length === 0) return new Map<string, ParcelApplicationRow>();
  const supabase = await createClient();
  const res = await supabase
    .from("applications")
    .select("id, number, status, created_by, land_use, site_check_status, site_check_surveyor")
    .in("number", numbers);
  return new Map((unwrap(res, "applications") as ParcelApplicationRow[]).map((a) => [a.number, a]));
}
