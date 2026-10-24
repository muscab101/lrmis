import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import { PARTY_COLUMNS, type PartyRow } from "./applications";

export type SurveyStatus = "assigned" | "in_progress" | "submitted" | "overlap_review" | "returned" | "cancelled";

export interface SurveyRow {
  id: string;
  status: SurveyStatus;
  due_date: string | null;
  assigned_at: string;
  submitted_at: string | null;
  area_m2: number | null;
  surveyor_id: string;
  surveyor: { full_name: string } | null;
  application: { id: string; number: string; type: string; neighbourhood: { code: string; name_so: string; name_en: string } | null; district: { code: string; name_so: string; name_en: string } | null } | null;
}

export async function querySurveys(opts: { status: SurveyStatus | "open" | "any"; mine: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let req = supabase
    .from("surveys")
    .select(
      "id, status, due_date, assigned_at, submitted_at, area_m2, surveyor_id, surveyor:profiles!surveys_surveyor_id_fkey(full_name), application:applications!surveys_application_id_fkey(id, number, type, neighbourhood:neighbourhoods(code, name_so, name_en), district:districts(code, name_so, name_en))",
    );
  if (opts.status === "open") req = req.in("status", ["assigned", "in_progress", "returned", "overlap_review"]);
  else if (opts.status !== "any") req = req.eq("status", opts.status);
  if (opts.mine) req = req.eq("surveyor_id", user?.id ?? "");
  const res = await req.order("assigned_at", { ascending: false }).limit(100);
  return unwrap(res, "surveys") as unknown as SurveyRow[];
}

/** Land existence checks ("!") waiting on a surveyor: mine, or all in my districts for supervisors. */
export interface SiteCheckRow {
  id: string;
  number: string;
  status: string;
  site_check_status: "pending";
  site_check_surveyor: string | null;
  site_check_requested_at: string;
  site_check_note: string | null;
  plot_no: string | null;
  district: { name_so: string; name_en: string } | null;
  neighbourhood: { name_so: string; name_en: string } | null;
  applicant: { full_name: string } | null;
}

export async function querySiteChecks(mine: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let req = supabase
    .from("applications")
    .select(
      "id, number, status, site_check_status, site_check_surveyor, site_check_requested_at, site_check_note, plot_no, district:districts(name_so, name_en), neighbourhood:neighbourhoods(name_so, name_en), applicant:parties!applications_applicant_party_id_fkey(full_name)",
    )
    .eq("site_check_status", "pending");
  if (mine) req = req.eq("site_check_surveyor", user?.id ?? "");
  const res = await req.order("site_check_requested_at", { ascending: true }).limit(100);
  return unwrap(res, "site checks") as unknown as SiteCheckRow[];
}

export interface SurveyDetail {
  id: string;
  application_id: string;
  status: SurveyStatus;
  surveyor_id: string;
  due_date: string | null;
  geom: GeoJSON.Polygon | null;
  area_m2: number | null;
  perimeter_m: number | null;
  accuracy_m: number | null;
  method: "drawn" | "gps_walk" | "imported" | null;
  neighbours: { north?: string; east?: string; south?: string; west?: string };
  building: { type?: string; floors?: number; use?: string; condition?: string };
  notes: string | null;
  overlap_list: { parcel_id: string; pun: string | null; status: string; overlap_m2: number }[];
  submitted_at: string | null;
  review_note: string | null;
  surveyor: { full_name: string } | null;
  application: {
    id: string;
    number: string;
    type: string;
    status: string;
    address_note: string;
    pin: { type: "Point"; coordinates: [number, number] } | null;
    plot_width_m: number | null;
    plot_length_m: number | null;
    neighbourhood_id: string | null;
    neighbourhood: { code: string; name_so: string; name_en: string } | null;
    district: { code: string; name_so: string; name_en: string } | null;
  } | null;
  survey_photos: { id: string; lon: number | null; lat: number | null; taken_at: string | null; caption: string | null; deleted_at: string | null }[];
}

export async function getSurvey(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("surveys")
    .select(
      `id, application_id, status, surveyor_id, due_date, geom, area_m2, perimeter_m, accuracy_m, method, neighbours, building, notes, overlap_list,
       submitted_at, review_note, surveyor:profiles!surveys_surveyor_id_fkey(full_name),
       application:applications!surveys_application_id_fkey(id, number, type, status, address_note, pin, plot_width_m, plot_length_m, neighbourhood_id, neighbourhood:neighbourhoods(code, name_so, name_en), district:districts(code, name_so, name_en)),
       survey_photos(id, lon, lat, taken_at, caption, deleted_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  const survey = unwrap(res, "survey") as unknown as SurveyDetail | null;
  if (!survey) return null;
  survey.survey_photos = survey.survey_photos.filter((p) => !p.deleted_at);
  let outline: { geometry: GeoJSON.Geometry; bbox: [number, number, number, number] } | null = null;
  if (survey.application?.neighbourhood_id) {
    const g = await supabase.rpc("location_geojson", { p_level: "neighbourhoods", p_id: survey.application.neighbourhood_id });
    outline = (g.data as typeof outline) ?? null;
  }
  return { survey, outline, file: await surveyFile(survey.application_id) };
}

/** The application behind a survey, with its owners and documents (the surveyor's case file). */
export interface SurveyFile {
  id: string;
  number: string;
  type: string;
  channel: string;
  status: string;
  plot_no: string | null;
  old_deed_no: string | null;
  govt_file_no: string | null;
  house_no: string | null;
  flat_no: string | null;
  govt_receipt_no: string | null;
  property_type: string | null;
  land_use: string | null;
  plot_width_m: number | null;
  plot_length_m: number | null;
  address_note: string;
  district: { name_so: string; name_en: string } | null;
  neighbourhood: { name_so: string; name_en: string } | null;
  application_parties: {
    role: string;
    share_pct: number | null;
    party: PartyRow | null;
  }[];
  application_documents: { id: string; doc_type: string; file_name: string }[];
  docTypes: { code: string; name_so: string; name_en: string }[];
}

async function surveyFile(applicationId: string): Promise<SurveyFile | null> {
  const supabase = await createClient();
  const [{ data }, { data: types }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        `id, number, type, channel, status, plot_no, old_deed_no, govt_file_no, house_no, flat_no, govt_receipt_no, property_type, land_use, plot_width_m, plot_length_m, address_note,
         district:districts(name_so, name_en), neighbourhood:neighbourhoods(name_so, name_en),
         application_parties(role, share_pct, party:parties(${PARTY_COLUMNS})),
         application_documents(id, doc_type, file_name)`,
      )
      .eq("id", applicationId)
      .maybeSingle(),
    supabase.from("document_types").select("code, name_so, name_en"),
  ]);
  if (!data) return null;
  return { ...(data as unknown as Omit<SurveyFile, "docTypes">), docTypes: (types ?? []) as SurveyFile["docTypes"] };
}

export async function surveyStatusCounts(): Promise<Partial<Record<SurveyStatus, number>>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("survey_status_counts");
  return Object.fromEntries(((data ?? []) as { status: SurveyStatus; total: number }[]).map((r) => [r.status, Number(r.total)]));
}

/** Check if it exists, for land (not applications): waiting on a surveyor — mine, or all in my districts for supervisors. */
export interface ParcelSiteCheckRow {
  id: string;
  pun: string | null;
  house_no: string | null;
  site_check_surveyor: string | null;
  site_check_requested_at: string;
  site_check_note: string | null;
  district: { name_so: string; name_en: string } | null;
  neighbourhood: { name_so: string; name_en: string } | null;
}

export async function queryParcelSiteChecks(mine: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let req = supabase
    .from("parcels")
    .select("id, pun, house_no, site_check_surveyor, site_check_requested_at, site_check_note, district:districts(name_so, name_en), neighbourhood:neighbourhoods(name_so, name_en)")
    .eq("site_check_status", "pending")
    .is("deleted_at", null);
  if (mine) req = req.eq("site_check_surveyor", user?.id ?? "");
  const res = await req.order("site_check_requested_at", { ascending: true }).limit(100);
  return unwrap(res, "parcel site checks") as unknown as ParcelSiteCheckRow[];
}
