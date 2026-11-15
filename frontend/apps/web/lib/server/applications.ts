import "server-only";
import { type ApplicationStatus, type ApplicationType, type LandUse, type PartiesQuery } from "@dhulka/core/schemas";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export const APP_PAGE_SIZE = 25;

export interface ApplicationListRow {
  id: string;
  number: string;
  type: ApplicationType;
  status: ApplicationStatus;
  channel: string;
  submitted_at: string | null;
  created_at: string;
  district: { code: string; name_so: string; name_en: string } | null;
  neighbourhood: { code: string; name_so: string; name_en: string } | null;
  applicant: { full_name: string; phone: string | null } | null;
  /** Site check: pending ("!"), confirmed (✓), not_found, or null (never asked). */
  site_check_status: SiteCheckStatus | null;
  site_check_surveyor: string | null;
  created_by: string | null;
  land_use: LandUse | null;
}

export type SiteCheckStatus = "pending" | "confirmed" | "not_found";

function cleanTerm(q: string) {
  return q.replace(/[,()*%\\]/g, " ").trim();
}

export interface PartyRow {
  id: string;
  kind: "person" | "organisation";
  full_name: string;
  mother_name: string | null;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  nationality: string;
  id_type: string | null;
  id_number: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  email: string | null;
  address: string | null;
  next_of_kin: { name?: string; phone?: string };
  org_registration_no: string | null;
  district_id: string | null;
  owner_type_id: string | null;
  owner_type: { name_so: string; name_en: string } | null;
  citizen_user_id: string | null;
  created_at: string;
  /** null while the owner is a draft (partial registration). */
  registered_at: string | null;
}

export const PARTY_COLUMNS =
  "id, kind, full_name, mother_name, gender, date_of_birth, nationality, id_type, id_number, phone, phone_verified_at, email, address, next_of_kin, org_registration_no, district_id, owner_type_id, owner_type:owner_types(name_so, name_en), citizen_user_id, created_at, registered_at";

export interface ApplicationDetail {
  id: string;
  number: string;
  type: ApplicationType;
  status: ApplicationStatus;
  channel: string;
  district_id: string;
  neighbourhood_id: string | null;
  pin: { type: "Point"; coordinates: [number, number] } | null;
  pin_accuracy_m: number | null;
  pin_method: "gps" | "manual" | null;
  pin_captured_at: string | null;
  pin_low_accuracy: boolean;
  site_check_status: SiteCheckStatus | null;
  site_check_surveyor: string | null;
  site_check_note: string | null;
  site_check_done_at: string | null;
  plot_width_m: number | null;
  plot_length_m: number | null;
  address_note: string;
  plot_no: string | null;
  old_deed_no: string | null;
  govt_file_no: string | null;
  house_no: string | null;
  flat_no: string | null;
  govt_receipt_no: string | null;
  property_type: string | null;
  land_use: LandUse | null;
  applicant_party_id: string | null;
  citizen_user_id: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  created_by: string | null;
  district: { id: string; code: string; name_so: string; name_en: string } | null;
  neighbourhood: { id: string; code: string; name_so: string; name_en: string } | null;
  application_parties: { party_id: string; role: string; share_pct: number | null; party: PartyRow }[];
  application_documents: { id: string; doc_type: string; file_name: string; mime_type: string; size_bytes: number; status: string; uploaded_at: string }[];
  application_events: { id: number; action: string; from_status: string | null; to_status: string | null; note: string | null; actor_id: string | null; at: string }[];
  fee_status: "due" | "paid" | "waived";
  fee_note: string | null;
  parcel_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export interface ApplicationStage {
  surveys: { id: string; status: string; surveyor_id: string; due_date: string | null; area_m2: number | null; submitted_at: string | null; surveyor: { full_name: string } | null }[];
  parcel: { id: string; pun: string | null; account_no: string | null; status: string; area_m2: number | null; land_use: string; geom: GeoJSON.Polygon } | null;
  /** The parcel's valid title certificate, once issued (the last step). */
  certificate: { id: string; serial: string } | null;
  notice: {
    id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    objections: { id: string; objector_name: string; objector_phone: string | null; statement: string; status: string; filed_at: string; resolution_note: string | null; filed_by: string | null }[];
  } | null;
}

export async function queryParties(q: PartiesQuery) {
  const supabase = await createClient();
  const term = cleanTerm(q.q);
  const staged = <T extends { is: (c: string, v: null) => T; not: (c: string, op: string, v: null) => T }>(req: T) =>
    q.stage === "draft" ? req.is("registered_at", null) : q.stage === "registered" ? req.not("registered_at", "is", null) : req;
  if (term) {
    // Typo-tolerant search via the RPC (RLS still applies: it runs as the caller), then the
    // full rows for the matches, kept in the RPC's order.
    const res = await supabase.rpc("search_parties", { p_q: term, p_limit: 50 });
    const ids = (unwrap(res, "search parties") as { id: string }[]).map((r) => r.id);
    if (!ids.length) return { rows: [] as PartyRow[], total: 0 };
    let req = supabase.from("parties").select(PARTY_COLUMNS).in("id", ids).is("deleted_at", null);
    if (q.kind) req = req.eq("kind", q.kind);
    const found = unwrap(await staged(req), "parties") as unknown as PartyRow[];
    const rows = ids.map((id) => found.find((r) => r.id === id)).filter((r): r is PartyRow => !!r);
    return { rows, total: rows.length };
  }
  let req = supabase.from("parties").select(PARTY_COLUMNS, { count: "exact" }).is("deleted_at", null);
  if (q.kind) req = req.eq("kind", q.kind);
  req = staged(req);
  const from = (q.page - 1) * APP_PAGE_SIZE;
  const res = await req.order("created_at", { ascending: false }).range(from, from + APP_PAGE_SIZE - 1);
  return { rows: unwrap(res, "parties") as unknown as PartyRow[], total: res.count ?? 0 };
}
