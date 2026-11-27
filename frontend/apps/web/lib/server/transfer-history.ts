import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** A transfer's state as people read it: a submitted one may be under review or waiting for more documents. */
export const TRANSFER_STATES = ["draft", "submitted", "under_review", "needs_documents", "approved", "rejected", "cancelled"] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export interface TransferHistoryRow {
  id: string;
  number: string;
  parcel_id: string | null;
  pun: string | null;
  house_no: string | null;
  nb_code: string | null;
  district_so: string | null;
  district_en: string | null;
  nb_so: string | null;
  nb_en: string | null;
  from_names: string | null;
  to_names: string | null;
  kind: string;
  type_so: string | null;
  type_en: string | null;
  on_date: string;
  files: number;
  state: TransferState;
}

export interface TransferHistoryFilters {
  q?: string;
  district?: string;
  neighbourhood?: string;
  type?: string;
  state?: TransferState | "pending";
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

/** Every transfer the user may see (their districts), newest first, with the counts for the summary cards. */
export async function transferHistory(f: TransferHistoryFilters) {
  const supabase = await createClient();
  const p = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));
  const out = unwrap(await supabase.rpc("transfer_history", { p }), "transfer history") as {
    total: number;
    rows: TransferHistoryRow[];
    stats: { total: number; pending: number; approved: number; rejected: number; this_month: number };
  };
  return { total: Number(out.total) || 0, rows: out.rows ?? [], stats: out.stats };
}

export interface TransferEvent {
  id: number;
  kind: string;
  note: string | null;
  data: Record<string, unknown>;
  at: string;
  actor: string | null;
  actor_name: string | null;
}

/** The transfer's activity, oldest first, with who did each step. */
export async function transferEvents(transferId: string): Promise<TransferEvent[]> {
  const supabase = await createClient();
  const rows = (unwrap(
    await supabase.from("transfer_events").select("id, kind, note, data, at, actor").eq("transfer_id", transferId).order("id"),
    "transfer events",
  ) ?? []) as Omit<TransferEvent, "actor_name">[];
  const ids = [...new Set(rows.map((r) => r.actor).filter((x): x is string => !!x))];
  const names = ids.length ? (((await supabase.rpc("staff_display_names", { p_user_ids: ids })).data ?? []) as { user_id: string; full_name: string }[]) : [];
  return rows.map((r) => ({ ...r, actor_name: names.find((n) => n.user_id === r.actor)?.full_name ?? null }));
}

export interface OwnerContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  id_type: string | null;
  id_number: string | null;
  address: string | null;
}

/** The people on a transfer, with their ID and contact details (only owners the user may see come back). */
export async function ownerContacts(ids: string[]): Promise<OwnerContact[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  return (unwrap(await supabase.from("parties").select("id, full_name, phone, email, id_type, id_number, address").in("id", ids), "owners") ?? []) as OwnerContact[];
}

export interface PlaceChain {
  district: { code: string; name_so: string; name_en: string } | null;
  section: { code: string; name_so: string; name_en: string } | null;
  sector: { code: string; name_so: string; name_en: string } | null;
  neighbourhood: { code: string; name_so: string; name_en: string } | null;
}

/** District → section → sector → neighbourhood of a parcel. */
export async function parcelPlace(parcelId: string): Promise<PlaceChain> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parcels")
    .select(
      "district:districts(code, name_so, name_en), neighbourhood:neighbourhoods(code, name_so, name_en, sector:sectors(code, name_so, name_en, section:sections(code, name_so, name_en)))",
    )
    .eq("id", parcelId)
    .maybeSingle();
  type Named = { code: string; name_so: string; name_en: string };
  const d = data as unknown as {
    district: Named | null;
    neighbourhood: (Named & { sector: (Named & { section: Named | null }) | null }) | null;
  } | null;
  const nb = d?.neighbourhood ?? null;
  return {
    district: d?.district ?? null,
    section: nb?.sector?.section ?? null,
    sector: nb?.sector ? { code: nb.sector.code, name_so: nb.sector.name_so, name_en: nb.sector.name_en } : null,
    neighbourhood: nb ? { code: nb.code, name_so: nb.name_so, name_en: nb.name_en } : null,
  };
}

export interface OwnershipPeriod {
  party_id: string;
  full_name: string;
  role: string;
  share_pct: number | null;
  valid_from: string | null;
  valid_to: string | null;
  current: boolean;
  source_transfer_id: string | null;
  source_number: string | null;
  ended_transfer_id: string | null;
  ended_number: string | null;
  ended_kind: string | null;
}

/** A parcel's owners, current first, each with the transfer that started or ended their ownership. */
export async function ownershipHistory(parcelId: string): Promise<OwnershipPeriod[]> {
  const supabase = await createClient();
  return (unwrap(await supabase.rpc("parcel_ownership_history", { p_parcel: parcelId }), "ownership history") ?? []) as OwnershipPeriod[];
}
