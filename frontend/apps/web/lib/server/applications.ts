import "server-only";
import type { ApplicationsQuery, ApplicationStatus, ApplicationType, PartiesQuery } from "@dhulka/core/schemas";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export const APP_PAGE_SIZE = 25;
const CLOSED: ApplicationStatus[] = ["approved", "rejected", "cancelled"];

export interface ApplicationListRow {
  id: string;
  number: string;
  type: ApplicationType;
  status: ApplicationStatus;
  channel: string;
  submitted_at: string | null;
  created_at: string;
  district: { code: string; name_so: string; name_en: string } | null;
  neighbourhood: { code: string; name_so: string } | null;
  applicant: { full_name: string; phone: string | null } | null;
}

function cleanTerm(q: string) {
  return q.replace(/[,()*%\\]/g, " ").trim();
}

export async function queryApplications(q: ApplicationsQuery, opts: { citizenOnly?: boolean } = {}) {
  const supabase = await createClient();
  let req = supabase
    .from("applications")
    .select(
      "id, number, type, status, channel, submitted_at, created_at, district:districts(code, name_so, name_en), neighbourhood:neighbourhoods(code, name_so), applicant:parties!applications_applicant_party_id_fkey(full_name, phone)",
      { count: "exact" },
    );
  if (q.status === "open") req = req.not("status", "in", `(${CLOSED.join(",")})`);
  else if (q.status !== "any") req = req.eq("status", q.status);
  if (q.type) req = req.eq("type", q.type);
  if (q.district) req = req.eq("district_id", q.district);
  if (opts.citizenOnly) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    req = req.eq("citizen_user_id", user?.id ?? "00000000-0000-0000-0000-000000000000");
  }
  const term = cleanTerm(q.q);
  if (term) {
    if (/^app-?\d/i.test(term)) {
      req = req.ilike("number", `${term}%`);
    } else {
      const { data: parties } = await supabase.rpc("search_parties", { p_q: term, p_limit: 50 });
      const ids = ((parties ?? []) as { id: string }[]).map((p) => p.id);
      req = req.in("applicant_party_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
  }
  const from = (q.page - 1) * APP_PAGE_SIZE;
  const res = await req.order("created_at", { ascending: false }).range(from, from + APP_PAGE_SIZE - 1);
  return { rows: unwrap(res, "applications") as unknown as ApplicationListRow[], total: res.count ?? 0 };
}

export async function applicationStatusCounts(): Promise<Partial<Record<ApplicationStatus, number>>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("application_status_counts");
  return Object.fromEntries(((data ?? []) as { status: ApplicationStatus; total: number }[]).map((r) => [r.status, Number(r.total)]));
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
  citizen_user_id: string | null;
  created_at: string;
}

export const PARTY_COLUMNS =
  "id, kind, full_name, mother_name, gender, date_of_birth, nationality, id_type, id_number, phone, phone_verified_at, email, address, next_of_kin, org_registration_no, district_id, citizen_user_id, created_at";

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
  address_note: string;
  plot_no: string | null;
  old_deed_no: string | null;
  govt_file_no: string | null;
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
  notice: {
    id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    objections: { id: string; objector_name: string; objector_phone: string | null; statement: string; status: string; filed_at: string; resolution_note: string | null; filed_by: string | null }[];
  } | null;
}

export async function getApplication(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("applications")
    .select(
      `id, number, type, status, channel, district_id, neighbourhood_id, pin, pin_accuracy_m, address_note, plot_no, old_deed_no, govt_file_no,
       applicant_party_id, citizen_user_id, submitted_at, decided_at, decision_note, created_at, created_by,
       district:districts(id, code, name_so, name_en), neighbourhood:neighbourhoods(id, code, name_so, name_en),
       application_parties(party_id, role, share_pct, party:parties(${PARTY_COLUMNS})),
       application_documents(id, doc_type, file_name, mime_type, size_bytes, status, uploaded_at, deleted_at),
       application_events(id, action, from_status, to_status, note, actor_id, at),
       fee_status, fee_note, parcel_id, verified_by, verified_at`,
    )
    .eq("id", id)
    .is("application_documents.deleted_at", null)
    .maybeSingle();
  const app = unwrap(res, "application") as unknown as ApplicationDetail | null;
  if (!app) return null;
  app.application_events.sort((a, b) => a.id - b.id);

  const [checklist, nearby, docTypes, surveys, parcel, notices] = await Promise.all([
    supabase.rpc("application_checklist", { p_id: id }),
    supabase.rpc("application_nearby", { p_id: id, p_meters: 10 }),
    supabase.from("document_types").select("code, name_so, name_en, required_for, sort").order("sort"),
    supabase
      .from("surveys")
      .select("id, status, surveyor_id, due_date, area_m2, submitted_at, surveyor:profiles!surveys_surveyor_id_fkey(full_name)")
      .eq("application_id", id)
      .order("assigned_at", { ascending: false }),
    app.parcel_id
      ? supabase.from("parcels").select("id, pun, account_no, status, area_m2, land_use, geom").eq("id", app.parcel_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("public_notices")
      .select("id, status, starts_at, ends_at, objections(id, objector_name, objector_phone, statement, status, filed_at, resolution_note, filed_by)")
      .eq("application_id", id)
      .order("starts_at", { ascending: false })
      .limit(1),
  ]);
  const stage: ApplicationStage = {
    surveys: (surveys.data ?? []) as unknown as ApplicationStage["surveys"],
    parcel: (parcel.data ?? null) as ApplicationStage["parcel"],
    notice: ((notices.data ?? [])[0] ?? null) as ApplicationStage["notice"],
  };
  return {
    app,
    stage,
    checklist: (checklist.data ?? []) as { code: string; value?: string | number }[],
    nearby: (nearby.data ?? []) as { id: string; number: string; status: ApplicationStatus; distance_m: number }[],
    docTypes: (docTypes.data ?? []) as { code: string; name_so: string; name_en: string; required_for: ApplicationType[] }[],
  };
}

export async function queryParties(q: PartiesQuery) {
  const supabase = await createClient();
  const term = cleanTerm(q.q);
  if (term) {
    // Typo-tolerant search via the RPC (RLS still applies: it runs as the caller).
    const res = await supabase.rpc("search_parties", { p_q: term, p_limit: 50 });
    const rows = (unwrap(res, "search parties") as PartyRow[]).filter((r) => !q.kind || r.kind === q.kind);
    return { rows, total: rows.length };
  }
  let req = supabase.from("parties").select(PARTY_COLUMNS, { count: "exact" }).is("deleted_at", null);
  if (q.kind) req = req.eq("kind", q.kind);
  const from = (q.page - 1) * APP_PAGE_SIZE;
  const res = await req.order("created_at", { ascending: false }).range(from, from + APP_PAGE_SIZE - 1);
  return { rows: unwrap(res, "parties") as unknown as PartyRow[], total: res.count ?? 0 };
}
