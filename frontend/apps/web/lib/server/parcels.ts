import "server-only";
import { cache } from "react";
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
  building_state: "standing" | "demolished";
  parent_id: string | null;
  /** Money was received on it, so it can't be deleted. */
  has_money: boolean;
}

/** Of these parcels, the ones money was received on (the database refuses to delete those). */
export async function parcelsWithMoney(ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const supabase = await createClient();
  const [{ data: bills }, { data: payments }] = await Promise.all([
    supabase.from("invoices").select("parcel_id").in("parcel_id", ids).neq("status", "cancelled").or("paid.gt.0,credited.gt.0"),
    supabase.from("payments").select("parcel_id").in("parcel_id", ids).neq("status", "reversed"),
  ]);
  return new Set([...((bills ?? []) as { parcel_id: string }[]), ...((payments ?? []) as { parcel_id: string }[])].map((r) => r.parcel_id));
}

export const PARCEL_STAGES = ["draft", "registered", "paid", "owing", "demolished", "all"] as const;
/** The tabs on Parcels: partial registration and registered ("all" is only used inside, e.g. a zone's houses). */
export const PARCEL_TABS = ["draft", "registered"] as const;
/** Inside Registered: all, paid (nothing owed), not paid, and the demolished archive. */
export const REGISTERED_SPLITS = ["all", "paid", "owing", "demolished"] as const;
export type ParcelStage = (typeof PARCEL_STAGES)[number];

export async function searchParcels(q: string, stage: ParcelStage = "all", neighbourhoodId: string | null = null) {
  const supabase = await createClient();
  // An old PUN typed off paper (BN34KRWJXL0107) finds the land by its PUN today.
  const term = /^\s*BN[\w-]{4,}\s*$/i.test(q) ? normalizePun(q) : q;
  // The tab and the neighbourhood are chosen inside the search, before it keeps the 100 newest.
  const req = supabase.rpc("search_parcels", {
    p_q: term.replace(/[%\\]/g, " ").trim(),
    p_limit: 100,
    p_stage: stage === "all" ? null : stage,
    p_neighbourhood: neighbourhoodId,
  });
  const res = await req.limit(100);
  // Newest first; the flats of one building, saved together, in order.
  const rows = (unwrap(res, "parcels") as ParcelListRow[]).sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.pun ?? "").localeCompare(b.pun ?? "", undefined, { numeric: true }));
  // The account number isn't in search_parcels: one lookup for the rows shown.
  if (rows.length) {
    // Both lookups at once (not one after the other).
    const ids = rows.map((r) => r.id);
    const [{ data }, money] = await Promise.all([
      supabase.from("parcels").select("id, account_no").in("id", ids),
      parcelsWithMoney(ids),
    ]);
    const acct = new Map(((data ?? []) as { id: string; account_no: string | null }[]).map((a) => [a.id, a.account_no]));
    for (const r of rows) {
      r.account_no = acct.get(r.id) ?? null;
      r.has_money = money.has(r.id);
    }
  }
  return rows;
}

export interface ParcelDetail {
  developed: boolean;
  /** A normal house, or a land holding units: a flats building or a shared compound. */
  layout: "house" | "flats" | "compound";
  building_state: "standing" | "demolished";
  building_no: string | null;
  floors: number | null;
  /** Flats building: the ground it covers, and who pays its open-ground bill. */
  footprint_m2: number | null;
  manager_name: string | null;
  manager_phone: string | null;
  /** A flat's share of its building, out of 10,000. */
  unit_factor: number | null;
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
  /** The day each year its tax bill comes and its certificate ends. */
  tax_anniversary: string | null;
  geom: GeoJSON.Polygon;
  /** Put on the map by guess (no survey yet): shown as a small square, to be remapped. */
  geom_provisional: boolean;
  application_id: string | null;
  application: { id: string; number: string } | null;
  /** Check if it exists: pending while a surveyor goes; confirmed or not_found once answered. */
  site_check_status: "pending" | "confirmed" | "not_found" | null;
  site_check_surveyor: string | null;
  site_check_requested_at: string | null;
  site_check_done_at: string | null;
  site_check_note: string | null;
  /** Remapping given to a surveyor: assigned until they remap it, then done. */
  remap_status: "assigned" | "done" | null;
  remap_surveyor: string | null;
  remap_requested_at: string | null;
  remap_note: string | null;
  district: { code: string; name_so: string; name_en: string } | null;
  neighbourhood: { code: string; name_so: string; name_en: string } | null;
  parcel_owners: { id: string; role: string; share_pct: number | null; valid_from: string; valid_to: string | null; party: PartyRow }[];
  parcel_history: HistoryEntry[];
}

/** What a history line was about: the transfer or parcel change behind it, who it went from and to, and other PUNs. */
export interface HistoryDetail {
  transferKind?: string;
  /** The transfer's type as named in Valuation → Transfer types. */
  transferType?: { name_so: string; name_en: string };
  changeKind?: string;
  number?: string;
  from?: string[];
  to?: string[];
  /** Created from: the parcel it came from. Subdivided / merged: the parcels it became. */
  puns?: string[];
  landUse?: string;
}
type HistoryEntry = { id: number; action: string; note: string | null; data?: Record<string, unknown>; at: string; detail?: HistoryDetail };

async function loadParcel(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("parcels")
    .select(
      `id, pun, account_no, status, land_use, ownership, developed, layout, floors, footprint_m2, manager_name, manager_phone, unit_factor, shared_split, building_state, building_no, parent_id, unit_no, unit_floor, own_m2, shared_m2, area_m2, perimeter_m, plot_no, deed_no, govt_file_no, house_no, flat_no, govt_receipt_no, property_type, locked_at, lock_reason, registered_at, tax_anniversary, geom, geom_provisional, application_id,
       site_check_status, site_check_surveyor, site_check_requested_at, site_check_done_at, site_check_note,
       remap_status, remap_surveyor, remap_requested_at, remap_note,
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


/** One land with its owners and history. Loaded once per request (the page title and the page share it). */
export const getParcel = cache(loadParcel);
export interface LandUnit {
  id: string;
  pun: string | null;
  unit_no: string;
  unit_floor: number | null;
  own_m2: number | null;
  shared_m2: number | null;
  area_m2: number | null;
  unit_factor: number | null;
  owners: string[];
  owed: number;
}

/** A building's or compound's units, what each owes, and its shared spaces. */
export async function getLandUnits(parcelId: string) {
  const supabase = await createClient();
  const [{ data: units }, { data: spaces }] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, pun, unit_no, unit_floor, own_m2, shared_m2, area_m2, unit_factor, parcel_owners(valid_to, party:parties(full_name))")
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
    transferIds.size ? supabase.from("transfers").select("id, number, kind, from_owners, to_owners, type:transfer_types(name_so, name_en)").in("id", [...transferIds]) : null,
    changeIds.size ? supabase.from("parcel_changes").select("id, number, kind").in("id", [...changeIds]) : null,
    changeNumbers.size ? supabase.from("parcel_changes").select("id, number, kind").in("number", [...changeNumbers]) : null,
    parcelIds.size ? supabase.from("parcels").select("id, pun").in("id", [...parcelIds]) : null,
  ]);
  type Owner = { full_name?: string };
  const tr = new Map(
    ((transfers?.data ?? []) as unknown as { id: string; number: string; kind: string; from_owners: Owner[]; to_owners: Owner[]; type: { name_so: string; name_en: string } | null }[]).map((x) => [x.id, x]),
  );
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
      if (t.type) detail.transferType = t.type;
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
/**
 * Every Parcels tab's number, read in one pass (public.parcel_stage_counts, as the viewer) and shared by the page and
 * its tabs for the request. Paid = registered − owing; apartment buildings for the Apartments tab.
 */
export const parcelStageCounts = cache(async (): Promise<Record<ParcelStage, number> & { flats: number }> => {
  const supabase = await createClient();
  const res = await supabase.rpc("parcel_stage_counts");
  const c = (unwrap(res, "parcel_stage_counts") ?? {}) as Partial<Record<"draft" | "registered" | "owing" | "demolished" | "flats", number>>;
  const draft = Number(c.draft ?? 0);
  const reg = Number(c.registered ?? 0);
  const owing = Number(c.owing ?? 0);
  return { draft, registered: reg, paid: Math.max(reg - owing, 0), owing, demolished: Number(c.demolished ?? 0), all: draft + reg, flats: Number(c.flats ?? 0) };
});

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
  // All ~5,300 neighbourhoods in one answer (the plain list stops at 1,000 rows a request).
  const rows = (unwrap(
    await supabase.rpc("neighbourhood_registration_status_all", { p_district: districtId }),
    "neighbourhoods",
  ) ?? []) as NeighbourhoodStatusRow[];
  return rows.map((r) => ({
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

