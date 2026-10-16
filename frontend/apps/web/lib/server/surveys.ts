import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

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
  application: { id: string; number: string; type: string; neighbourhood: { code: string; name_so: string } | null; district: { code: string; name_so: string } | null } | null;
}

export async function querySurveys(opts: { status: SurveyStatus | "open" | "any"; mine: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let req = supabase
    .from("surveys")
    .select(
      "id, status, due_date, assigned_at, submitted_at, area_m2, surveyor_id, surveyor:profiles!surveys_surveyor_id_fkey(full_name), application:applications!surveys_application_id_fkey(id, number, type, neighbourhood:neighbourhoods(code, name_so), district:districts(code, name_so))",
    );
  if (opts.status === "open") req = req.in("status", ["assigned", "in_progress", "returned", "overlap_review"]);
  else if (opts.status !== "any") req = req.eq("status", opts.status);
  if (opts.mine) req = req.eq("surveyor_id", user?.id ?? "");
  const res = await req.order("assigned_at", { ascending: false }).limit(100);
  return unwrap(res, "surveys") as unknown as SurveyRow[];
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
    neighbourhood_id: string | null;
    neighbourhood: { code: string; name_so: string } | null;
    district: { code: string; name_so: string } | null;
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
       application:applications!surveys_application_id_fkey(id, number, type, status, address_note, pin, neighbourhood_id, neighbourhood:neighbourhoods(code, name_so), district:districts(code, name_so)),
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
  return { survey, outline };
}

export async function surveyStatusCounts(): Promise<Partial<Record<SurveyStatus, number>>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("survey_status_counts");
  return Object.fromEntries(((data ?? []) as { status: SurveyStatus; total: number }[]).map((r) => [r.status, Number(r.total)]));
}
