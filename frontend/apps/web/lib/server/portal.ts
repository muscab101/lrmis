import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

type Named = { name_so: string; name_en: string } | null;

export interface CitizenParcel {
  id: string;
  pun: string | null;
  status: string;
  land_use: string;
  area_m2: number | null;
  district: Named;
  neighbourhood: Named;
  share: number | null;
  balance: number;
  overdue: number;
  invoices: { id: string; number: string; period: string; due_date: string; total: number; balance: number; status: string; fee_so: string; fee_en: string; token: string | null }[];
  documents: { id: string; type: "certificate" | "id_card"; serial: string; status: string; verify_code: string; issued_at: string; expires_at: string | null }[];
  geom: GeoJSON.Polygon | null;
}

export interface CitizenOverview {
  parcels: CitizenParcel[];
  messages: { id: string; body: string; status: string; created_at: string }[];
  payments: { id: string; receipt_no: string; amount: number; received_at: string; pun: string | null; method: string }[];
}

/** Everything linked to the signed-in citizen (owned parcels, bills with pay links, documents, receipts, SMS). */
export async function citizenOverview(): Promise<CitizenOverview> {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("citizen_overview"), "overview") as CitizenOverview;
}
