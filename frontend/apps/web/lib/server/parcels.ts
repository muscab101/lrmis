import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import { PARTY_COLUMNS, type PartyRow } from "./applications";

export type ParcelStatus = "draft" | "surveyed" | "verified" | "registered" | "disputed" | "archived";

export interface ParcelListRow {
  id: string;
  pun: string | null;
  status: ParcelStatus;
  area_m2: number | null;
  district: string;
  neighbourhood: string | null;
  owners: string | null;
}

export async function searchParcels(q: string) {
  const supabase = await createClient();
  const res = await supabase.rpc("search_parcels", { p_q: q.replace(/[%\\]/g, " ").trim(), p_limit: 50 });
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
  registered_at: string | null;
  geom: GeoJSON.Polygon;
  application_id: string | null;
  application: { id: string; number: string } | null;
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
      `id, pun, account_no, status, land_use, ownership, developed, area_m2, perimeter_m, plot_no, deed_no, govt_file_no, registered_at, geom, application_id,
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
