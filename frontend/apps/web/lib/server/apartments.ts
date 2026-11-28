import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

type Named = { code?: string; name_so: string; name_en: string } | null;

export interface ApartmentRow {
  id: string;
  pun: string | null;
  building_no: string | null;
  house_no: string | null;
  layout: "flats" | "compound";
  floors: number | null;
  status: string;
  manager_name: string | null;
  manager_phone: string | null;
  neighbourhood: Named;
  district: Named;
  units: number;
  registered: number;
  partial: number;
  owed: number;
}

const PARTIAL = ["draft", "surveyed", "verified"];
const OPEN_BILL = ["issued", "partially_paid"];

/** Apartment buildings (flats) or compounds in the person's districts, with their units and what they still owe. */
export async function listApartments(opts: { layout: "flats" | "compound"; q: string; owing: boolean }) {
  const supabase = await createClient();
  let req = supabase
    .from("parcels")
    .select("id, pun, building_no, house_no, layout, floors, status, manager_name, manager_phone, neighbourhood:neighbourhoods(code, name_so, name_en), district:districts(name_so, name_en)")
    .is("deleted_at", null)
    .eq("layout", opts.layout);
  const q = opts.q.replace(/[%,()]/g, " ").trim();
  if (q) req = req.or(`pun.ilike.%${q}%,building_no.ilike.%${q}%,house_no.ilike.%${q}%,manager_name.ilike.%${q}%`);
  const buildings = unwrap(await req.order("created_at", { ascending: false }).limit(300), "apartments") as unknown as Omit<
    ApartmentRow,
    "units" | "registered" | "partial" | "owed"
  >[];
  const ids = buildings.map((b) => b.id);
  const { data: units } = ids.length
    ? await supabase.from("parcels").select("id, parent_id, status").in("parent_id", ids).is("deleted_at", null)
    : { data: [] };
  const unitRows = (units ?? []) as { id: string; parent_id: string; status: string }[];
  const billed = [...ids, ...unitRows.map((u) => u.id)];
  const { data: bills } = billed.length
    ? await supabase.from("invoices").select("parcel_id, balance").in("parcel_id", billed).in("status", OPEN_BILL)
    : { data: [] };
  const owedBy = new Map<string, number>();
  for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) owedBy.set(b.parcel_id, (owedBy.get(b.parcel_id) ?? 0) + Number(b.balance));
  const rows: ApartmentRow[] = buildings.map((b) => {
    const mine = unitRows.filter((u) => u.parent_id === b.id);
    return {
      ...b,
      units: mine.length,
      registered: mine.filter((u) => u.status === "registered").length,
      partial: mine.filter((u) => PARTIAL.includes(u.status)).length,
      owed: (owedBy.get(b.id) ?? 0) + mine.reduce((s, u) => s + (owedBy.get(u.id) ?? 0), 0),
    };
  });
  return opts.owing ? rows.filter((r) => r.owed > 0) : rows;
}

export interface ApartmentUnit {
  id: string;
  pun: string | null;
  unit_no: string | null;
  flat_no: string | null;
  unit_floor: number | null;
  own_m2: number | null;
  status: string;
  building_state: string;
  owners: string[];
  owed: number;
}

/** One building's flats (or a compound's houses), with owners, status and what each still owes. */
export async function apartmentUnits(buildingId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parcels")
    .select("id, pun, unit_no, flat_no, unit_floor, own_m2, status, building_state, parcel_owners(valid_to, party:parties(full_name))")
    .eq("parent_id", buildingId)
    .is("deleted_at", null)
    .order("unit_floor", { ascending: false, nullsFirst: false })
    .order("unit_no");
  const rows = (data ?? []) as unknown as (Omit<ApartmentUnit, "owners" | "owed"> & { parcel_owners: { valid_to: string | null; party: { full_name: string } | null }[] })[];
  const { data: bills } = rows.length
    ? await supabase.from("invoices").select("parcel_id, balance").in("parcel_id", rows.map((r) => r.id)).in("status", OPEN_BILL)
    : { data: [] };
  const owed = new Map<string, number>();
  for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) owed.set(b.parcel_id, (owed.get(b.parcel_id) ?? 0) + Number(b.balance));
  return rows.map(({ parcel_owners, ...u }): ApartmentUnit => ({
    ...u,
    owners: parcel_owners.filter((o) => !o.valid_to && o.party).map((o) => o.party!.full_name),
    owed: owed.get(u.id) ?? 0,
  }));
}

export interface ManagerRow {
  /** The manager's person record (owner page), when they are one. */
  partyId: string | null;
  name: string;
  phone: string | null;
  buildings: { id: string; pun: string | null; house_no: string | null; neighbourhood: string | null; owed: number }[];
  owed: number;
}

/**
 * Building managers: the person each apartment building names as its manager (who pays the building's open-ground
 * bill), with the buildings they manage and what those bills still owe; and the buildings with no manager yet.
 */
export async function listManagers(lang: string, q: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parcels")
    .select("id, pun, house_no, manager_party_id, manager_name, manager_phone, neighbourhood:neighbourhoods(code, name_so, name_en)")
    .is("deleted_at", null)
    .eq("layout", "flats")
    .order("manager_name", { nullsFirst: false })
    .limit(500);
  const rows = (data ?? []) as unknown as {
    id: string;
    pun: string | null;
    house_no: string | null;
    manager_party_id: string | null;
    manager_name: string | null;
    manager_phone: string | null;
    neighbourhood: { code: string; name_so: string; name_en: string } | null;
  }[];
  const { data: bills } = rows.length
    ? await supabase.from("invoices").select("parcel_id, balance").in("parcel_id", rows.map((r) => r.id)).in("status", OPEN_BILL)
    : { data: [] };
  const owed = new Map<string, number>();
  for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) owed.set(b.parcel_id, (owed.get(b.parcel_id) ?? 0) + Number(b.balance));
  const place = (n: (typeof rows)[number]["neighbourhood"]) => (n ? (lang === "so" ? n.name_so : n.name_en) : null);
  const term = q.trim().toLowerCase();
  const byManager = new Map<string, ManagerRow>();
  const without: ManagerRow["buildings"] = [];
  for (const r of rows) {
    const b = { id: r.id, pun: r.pun, house_no: r.house_no, neighbourhood: place(r.neighbourhood), owed: owed.get(r.id) ?? 0 };
    if (!r.manager_name?.trim()) {
      without.push(b);
      continue;
    }
    const key = r.manager_party_id ?? `${r.manager_name.trim().toLowerCase()}|${(r.manager_phone ?? "").replace(/\D/g, "")}`;
    const m = byManager.get(key) ?? { partyId: r.manager_party_id, name: r.manager_name.trim(), phone: r.manager_phone, buildings: [], owed: 0 };
    m.buildings.push(b);
    m.owed += b.owed;
    byManager.set(key, m);
  }
  const managers = [...byManager.values()]
    .filter((m) => !term || m.name.toLowerCase().includes(term) || (m.phone ?? "").includes(term) || m.buildings.some((b) => (b.pun ?? "").includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { managers, without };
}

export interface BuildingArea {
  id: string;
  name: string;
  area_m2: number;
  price_m2: number;
}

/** A building's extra areas (parking, playgrounds, …) and its manager (a person, like an owner). */
export async function buildingExtras(buildingId: string) {
  const supabase = await createClient();
  const [{ data: areas }, { data: b }] = await Promise.all([
    supabase.from("building_extra_areas").select("id, name, area_m2, price_m2").eq("parcel_id", buildingId).order("created_at"),
    supabase.from("parcels").select("manager_party_id, manager_name, manager_phone, manager:parties!parcels_manager_party_id_fkey(id, full_name, phone)").eq("id", buildingId).maybeSingle(),
  ]);
  const row = b as unknown as { manager_name: string | null; manager_phone: string | null; manager: { id: string; full_name: string; phone: string | null } | null } | null;
  return {
    areas: ((areas ?? []) as BuildingArea[]).map((a) => ({ ...a, area_m2: Number(a.area_m2), price_m2: Number(a.price_m2) })),
    manager: row?.manager ?? null,
    /** A name typed before managers were people (no person record yet). */
    legacyName: row && !row.manager && row.manager_name ? { name: row.manager_name, phone: row.manager_phone } : null,
  };
}

export interface SingleBuildingRow {
  id: string;
  pun: string | null;
  house_no: string | null;
  property_type: "apartment" | "storey";
  upper_storeys: number;
  status: string;
  neighbourhood: Named;
  district: Named;
  owners: string;
  owed: number;
}

/** Apartments and storey buildings owned whole by one owner (no flats): with their storeys, owner and what they owe. */
export async function listSingleBuildings(opts: { q: string; owing: boolean; type?: "apartment" | "storey"; page: number; size: number }) {
  const supabase = await createClient();
  let req = supabase
    .from("parcels")
    .select(
      "id, pun, house_no, property_type, upper_storeys, status, neighbourhood:neighbourhoods(code, name_so, name_en), district:districts(name_so, name_en), owners:parcel_owners(valid_to, party:parties(full_name))",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .eq("layout", "house")
    .is("parent_id", null)
    .in("property_type", opts.type ? [opts.type] : ["apartment", "storey"]);
  const q = opts.q.replace(/[%,()]/g, " ").trim();
  if (q) req = req.or(`pun.ilike.%${q}%,house_no.ilike.%${q}%`);
  if (opts.owing) {
    // Only those with an open bill: find them first.
    const { data: open } = await supabase
      .from("invoices")
      .select("parcel_id, parcel:parcels!inner(property_type, layout, parent_id)")
      .in("status", OPEN_BILL)
      .gt("balance", 0)
      .in("parcel.property_type", opts.type ? [opts.type] : ["apartment", "storey"])
      .eq("parcel.layout", "house")
      .limit(5000);
    const ids = [...new Set(((open ?? []) as { parcel_id: string }[]).map((r) => r.parcel_id))];
    req = req.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const res = await req
    .order("upper_storeys", { ascending: false })
    .order("pun")
    .range((opts.page - 1) * opts.size, opts.page * opts.size - 1);
  type Raw = Omit<SingleBuildingRow, "owners" | "owed"> & { owners: { valid_to: string | null; party: { full_name: string } | null }[] };
  const rows = (unwrap(res, "buildings") ?? []) as unknown as Raw[];
  const ids = rows.map((r) => r.id);
  const { data: bills } = ids.length
    ? await supabase.from("invoices").select("parcel_id, balance").in("parcel_id", ids).in("status", OPEN_BILL)
    : { data: [] };
  const owedBy = new Map<string, number>();
  for (const b of (bills ?? []) as { parcel_id: string; balance: number }[]) owedBy.set(b.parcel_id, (owedBy.get(b.parcel_id) ?? 0) + Number(b.balance));
  return {
    total: res.count ?? 0,
    rows: rows.map(({ owners, ...r }) => ({
      ...r,
      owners: owners.filter((o) => !o.valid_to && o.party).map((o) => o.party!.full_name).join(", ") || "—",
      owed: owedBy.get(r.id) ?? 0,
    })),
  };
}
