import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export type DemolitionStatus = "pending" | "approved" | "rejected" | "restored";

export interface DemolitionRow {
  id: string;
  number: string;
  parcel_id: string;
  status: DemolitionStatus;
  pun: string | null;
  house_no: string | null;
  owner_names: string | null;
  demolition_date: string;
  reason: string;
  demolished_by: string | null;
  archived_at: string | null;
  requested_at: string;
  rebuilt_at: string | null;
  building_no: string | null;
  new_house_no: string | null;
  snapshot: Snapshot;
  outstanding: number;
}

type Named = { id: string; code: string; name_so: string; name_en: string };

/** The land as it was when the demolition was approved. */
export interface Snapshot {
  pun: string | null;
  account_no: string | null;
  house_no: string | null;
  plot_no: string | null;
  deed_no: string | null;
  layout: "house" | "flats" | "compound";
  floors: number | null;
  unit_no: string | null;
  area_m2: number | null;
  land_use: string;
  grade_en: string | null;
  grade_so: string | null;
  registered_at: string | null;
  district: Named;
  section: Named | null;
  sector: Named | null;
  neighbourhood: Named | null;
  geom: GeoJSON.Polygon;
  owners: {
    party_id: string;
    full_name: string;
    phone: string | null;
    id_number: string | null;
    role: string;
    share_pct: number | null;
    valid_from: string | null;
  }[];
  units: {
    id: string;
    pun: string | null;
    unit_no: string;
    floor: number | null;
    area_m2: number | null;
    own_m2: number | null;
    shared_m2: number | null;
    house_no: string | null;
    owners: { full_name: string; phone: string | null }[];
  }[];
  shared_spaces: { name: string; area_m2: number }[];
  balance: number;
}

export interface DemolitionFilters {
  tab: "archive" | "pending" | "closed";
  d?: string;
  s?: string;
  k?: string;
  n?: string;
  from?: string;
  to?: string;
  q?: string;
}

const COLS =
  "id, number, parcel_id, status, pun, house_no, owner_names, demolition_date, reason, demolished_by, archived_at, requested_at, rebuilt_at, building_no, new_house_no, snapshot";
const isId = (v: string | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function listDemolitions(f: DemolitionFilters, limit = 300) {
  const supabase = await createClient();
  let req = supabase.from("demolitions").select(COLS);
  if (f.tab === "archive") req = req.eq("status", "approved");
  if (f.tab === "pending") req = req.eq("status", "pending");
  if (f.tab === "closed") req = req.in("status", ["rejected", "restored"]);
  if (isId(f.d)) req = req.eq("district_id", f.d!);
  if (isId(f.s)) req = req.eq("section_id", f.s!);
  if (isId(f.k)) req = req.eq("sector_id", f.k!);
  if (isId(f.n)) req = req.eq("neighbourhood_id", f.n!);
  if (isDay(f.from)) req = req.gte("demolition_date", f.from!);
  if (isDay(f.to)) req = req.lte("demolition_date", f.to!);
  const term = (f.q ?? "").replace(/[,()*%\\]/g, " ").trim();
  if (term)
    req = req.or(
      `pun.ilike.%${term}%,house_no.ilike.%${term}%,number.ilike.%${term}%,owner_names.ilike.%${term}%,new_house_no.ilike.%${term}%,building_no.ilike.%${term}%`,
    );
  const rows = unwrap(
    await req
      .order("demolition_date", { ascending: false })
      .order("number", { ascending: false })
      .limit(limit),
    "demolitions",
  ) as unknown as Omit<DemolitionRow, "outstanding">[];
  // What is still owed on each land and the units it had.
  const ids = rows.map((r) => r.parcel_id);
  const owed = new Map<string, number>();
  if (ids.length) {
    const { data: kids } = await supabase
      .from("parcels")
      .select("id, parent_id")
      .in("parent_id", ids);
    const top = new Map(
      ((kids ?? []) as { id: string; parent_id: string }[]).map((k) => [k.id, k.parent_id]),
    );
    const { data: bills } = await supabase
      .from("invoices")
      .select("parcel_id, balance")
      .in("parcel_id", [...ids, ...top.keys()])
      .in("status", ["issued", "partially_paid"]);
    for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) {
      const land = top.get(b.parcel_id) ?? b.parcel_id;
      owed.set(land, (owed.get(land) ?? 0) + Number(b.balance));
    }
  }
  return rows.map((r) => ({ ...r, outstanding: owed.get(r.parcel_id) ?? 0 }));
}

export interface DemolitionStats {
  total: number;
  this_year: number;
  waiting: number;
  rebuilt: number;
  outstanding: number;
  by_district: { name: string; name_so: string; count: number }[];
  by_sector: { name: string; name_so: string; count: number }[];
  by_neighbourhood: { name: string; name_so: string; count: number }[];
}

export async function demolitionStats() {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("demolition_stats"), "demolition stats") as DemolitionStats;
}

export interface DemolitionDetail {
  id: string;
  number: string;
  parcel_id: string;
  status: DemolitionStatus;
  demolition_date: string;
  reason: string;
  notes: string | null;
  demolished_by: string | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  archived_at: string | null;
  restored_at: string | null;
  restore_reason: string | null;
  rebuilt_at: string | null;
  building_no: string | null;
  new_house_no: string | null;
  new_owner_names: string | null;
  rebuild_note: string | null;
  house_no: string | null;
  snapshot: Snapshot;
}

export interface DemolitionHistory {
  invoices: {
    id: string;
    number: string;
    pun: string | null;
    fee_en: string | null;
    fee_so: string | null;
    period: string;
    issue_date: string;
    total: number;
    paid: number;
    balance: number;
    status: string;
  }[];
  owner_history: {
    full_name: string;
    phone: string | null;
    role: string;
    pun: string | null;
    valid_from: string | null;
    valid_to: string | null;
  }[];
  others: {
    id: string;
    number: string;
    status: DemolitionStatus;
    house_no: string | null;
    demolition_date: string;
    building_no: string | null;
    new_house_no: string | null;
  }[];
  names: {
    requested_by: string | null;
    decided_by: string | null;
    restored_by: string | null;
    rebuilt_by: string | null;
  };
  audit: { at: string; action: string; by: string | null }[];
}

export async function getDemolition(id: string) {
  if (!isId(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("demolitions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const history = unwrap(
    await supabase.rpc("demolition_history", { p_id: id }),
    "demolition history",
  ) as DemolitionHistory;
  return { row: data as unknown as DemolitionDetail, history };
}

/** The demolition a land is waiting on or still under, for its parcel page. */
export async function openDemolitionOf(parcelId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("demolitions")
    .select("id, number, status, demolition_date, building_no, rebuilt_at")
    .eq("parcel_id", parcelId)
    .in("status", ["pending", "approved"])
    .order("requested_at", { ascending: false });
  return (data ?? []) as {
    id: string;
    number: string;
    status: "pending" | "approved";
    demolition_date: string;
    building_no: string | null;
    rebuilt_at: string | null;
  }[];
}
