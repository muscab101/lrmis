import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { PARTY_COLUMNS, type PartyRow, type SiteCheckStatus } from "./applications";
import { normalizePun } from "@/lib/pun";

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
  account_no?: string | null;
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
/** The tabs on Parcels: partial registration and registered ("all" is only used inside, e.g. a zone's houses). */
export const PARCEL_TABS = ["draft", "registered"] as const;
/** Inside Registered: all, paid (nothing owed) and not paid. */
export const REGISTERED_SPLITS = ["all", "paid", "owing"] as const;
export type ParcelStage = (typeof PARCEL_STAGES)[number];
/** Not registered yet: partial registration, still worked on through its application. */
const PARTIAL = "(draft,surveyed,verified)";

export async function searchParcels(q: string, stage: ParcelStage = "all", neighbourhoodId: string | null = null) {
  const supabase = await createClient();
  // An old PUN typed off paper (BN34KRWJXL0107) finds the land by its PUN today.
  const term = /^\s*BN[\w-]{4,}\s*$/i.test(q) ? normalizePun(q) : q;
  let req = supabase.rpc("search_parcels", { p_q: term.replace(/[%\\]/g, " ").trim(), p_limit: 1000 });
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
  const rows = unwrap(res, "parcels") as ParcelListRow[];
  // The account number isn't in search_parcels: one lookup for the rows shown.
  if (rows.length) {
    const { data } = await supabase.from("parcels").select("id, account_no").in("id", rows.map((r) => r.id));
    const acct = new Map(((data ?? []) as { id: string; account_no: string | null }[]).map((a) => [a.id, a.account_no]));
    for (const r of rows) r.account_no = acct.get(r.id) ?? null;
  }
  return rows;
}

export interface ParcelDetail {
  developed: boolean;
  /** A normal house, or a land holding units: a flats building or a shared compound. */
  layout: "house" | "flats" | "compound";
  floors: number | null;
  shared_split: "equal" | "by_size" | null;
  /** On a unit: the land it belongs to, its number and floor, and its m². */
  parent_id: string | null;
  unit_no: string | null;
  unit_floor: number | null;
  own_m2: number | null;
  shared_m2: number | null;
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
  parcel_history: HistoryEntry[];
}

/** What a history line was about: the transfer or parcel change behind it, who it went from and to, and other PUNs. */
export interface HistoryDetail {
  transferKind?: string;
  changeKind?: string;
  number?: string;
  from?: string[];
  to?: string[];
  /** Created from: the parcel it came from. Subdivided / merged: the parcels it became. */
  puns?: string[];
  landUse?: string;
}
type HistoryEntry = { id: number; action: string; note: string | null; data?: Record<string, unknown>; at: string; detail?: HistoryDetail };

export async function getParcel(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("parcels")
    .select(
      `id, pun, account_no, status, land_use, ownership, developed, layout, floors, shared_split, parent_id, unit_no, unit_floor, own_m2, shared_m2, area_m2, perimeter_m, plot_no, deed_no, govt_file_no, house_no, flat_no, govt_receipt_no, property_type, locked_at, lock_reason, registered_at, geom, application_id,
       site_check_status, site_check_surveyor, site_check_requested_at, site_check_done_at, site_check_note,
       application:applications!parcels_application_id_fkey(id, number),
       district:districts(code, name_so, name_en), neighbourhood:neighbourhoods(code, name_so, name_en),
       parcel_owners(id, role, share_pct, valid_from, valid_to, party:parties(${PARTY_COLUMNS})),
       parcel_history(id, action, note, data, at)`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const parcel = unwrap(res, "parcel") as unknown as ParcelDetail | null;
  if (parcel) {
    parcel.parcel_history.sort((a, b) => b.id - a.id);
    await describeHistory(supabase, parcel.parcel_history);
  }
  return parcel;
}

export interface LandUnit {
  id: string;
  pun: string | null;
  unit_no: string;
  unit_floor: number | null;
  own_m2: number | null;
  shared_m2: number | null;
  area_m2: number | null;
  owners: string[];
  owed: number;
}

/** A building's or compound's units, what each owes, and its shared spaces. */
export async function getLandUnits(parcelId: string) {
  const supabase = await createClient();
  const [{ data: units }, { data: spaces }] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, pun, unit_no, unit_floor, own_m2, shared_m2, area_m2, parcel_owners(valid_to, party:parties(full_name))")
      .eq("parent_id", parcelId)
      .is("deleted_at", null)
      .order("unit_no"),
    supabase.from("parcel_shared_spaces").select("id, name, area_m2").eq("parcel_id", parcelId).order("area_m2", { ascending: false }),
  ]);
  const rows = (units ?? []) as unknown as (Omit<LandUnit, "owners" | "owed"> & { parcel_owners: { valid_to: string | null; party: { full_name: string } | null }[] })[];
  const { data: bills } = rows.length
    ? await supabase.from("invoices").select("parcel_id, balance").in("parcel_id", rows.map((r) => r.id)).in("status", ["issued", "partially_paid"])
    : { data: [] };
  const owed = new Map<string, number>();
  for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) owed.set(b.parcel_id, (owed.get(b.parcel_id) ?? 0) + Number(b.balance));
  return {
    units: rows.map(({ parcel_owners, ...u }): LandUnit => ({
      ...u,
      owners: parcel_owners.filter((o) => !o.valid_to && o.party).map((o) => o.party!.full_name),
      owed: owed.get(u.id) ?? 0,
    })),
    spaces: (spaces ?? []) as { id: string; name: string; area_m2: number }[],
  };
}

/** The land a unit belongs to. */
export async function getParentLand(parentId: string) {
  const { data } = await (await createClient()).from("parcels").select("id, pun, layout").eq("id", parentId).maybeSingle();
  return data as { id: string; pun: string | null; layout: "flats" | "compound" } | null;
}

/** Fill in each history line's detail: the kind and number of the transfer or change, the people, the other PUNs. */
async function describeHistory(supabase: Awaited<ReturnType<typeof createClient>>, rows: HistoryEntry[]) {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const transferIds = new Set<string>();
  const changeIds = new Set<string>();
  const changeNumbers = new Set<string>();
  const parcelIds = new Set<string>();
  for (const h of rows) {
    const d = h.data ?? {};
    if (str(d.transfer_id)) transferIds.add(str(d.transfer_id)!);
    if (str(d.change_id)) changeIds.add(str(d.change_id)!);
    if (h.action === "created_from" && h.note?.startsWith("PCH")) changeNumbers.add(h.note);
    if (str(d.source_parcel)) parcelIds.add(str(d.source_parcel)!);
    if (Array.isArray(d.new_parcels)) for (const p of d.new_parcels) if (str(p)) parcelIds.add(p as string);
  }
  const [transfers, changes, byNumber, parcels] = await Promise.all([
    transferIds.size ? supabase.from("transfers").select("id, number, kind, from_owners, to_owners").in("id", [...transferIds]) : null,
    changeIds.size ? supabase.from("parcel_changes").select("id, number, kind").in("id", [...changeIds]) : null,
    changeNumbers.size ? supabase.from("parcel_changes").select("id, number, kind").in("number", [...changeNumbers]) : null,
    parcelIds.size ? supabase.from("parcels").select("id, pun").in("id", [...parcelIds]) : null,
  ]);
  type Owner = { full_name?: string };
  const tr = new Map(((transfers?.data ?? []) as { id: string; number: string; kind: string; from_owners: Owner[]; to_owners: Owner[] }[]).map((x) => [x.id, x]));
  const ch = new Map(((changes?.data ?? []) as { id: string; number: string; kind: string }[]).map((x) => [x.id, x]));
  const chNo = new Map(((byNumber?.data ?? []) as { id: string; number: string; kind: string }[]).map((x) => [x.number, x]));
  const pun = new Map(((parcels?.data ?? []) as { id: string; pun: string | null }[]).map((x) => [x.id, x.pun]));
  const names = (o: unknown) => (Array.isArray(o) ? (o as Owner[]).map((x) => x.full_name ?? "").filter(Boolean) : []);
  for (const h of rows) {
    const d = h.data ?? {};
    const detail: HistoryDetail = {};
    const t = str(d.transfer_id) ? tr.get(str(d.transfer_id)!) : undefined;
    if (t) {
      detail.transferKind = t.kind;
      detail.number = t.number;
      if (h.action === "transferred") {
        detail.from = names(d.from ?? t.from_owners);
        detail.to = names(d.to ?? t.to_owners);
      }
    } else if (str(d.kind) && h.action.startsWith("transfer")) detail.transferKind = str(d.kind)!;
    const c = str(d.change_id) ? ch.get(str(d.change_id)!) : h.action === "created_from" && h.note ? chNo.get(h.note) : undefined;
    if (c) {
      detail.changeKind = c.kind;
      detail.number = c.number;
    } else if (h.action === "created_from" && str(d.kind)) detail.changeKind = str(d.kind)!;
    if (h.action === "created_from") {
      const from = str(d.pun) ?? (str(d.source_parcel) ? pun.get(str(d.source_parcel)!) : null);
      if (from) detail.puns = [from];
    }
    if (Array.isArray(d.new_parcels)) detail.puns = (d.new_parcels as string[]).map((p) => pun.get(p)).filter((x): x is string => !!x);
    if (h.action === "use_changed" && str(d.land_use)) detail.landUse = str(d.land_use)!;
    if (Object.keys(detail).length) h.detail = detail;
    delete h.data;
  }
}

/** Parcel counts for the stage tabs (RLS: only districts the viewer can see). */
export async function parcelStageCounts(): Promise<Record<ParcelStage, number>> {
  const supabase = await createClient();
  const base = () => supabase.from("parcels").select("id", { count: "exact", head: true }).is("deleted_at", null).is("parent_id", null).neq("status", "archived");
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
