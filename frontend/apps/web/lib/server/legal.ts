import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export type RequestStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
type OwnerEntry = { party_id: string; full_name: string; role: string; share_pct: number | null };

export interface TransferRow {
  id: string;
  number: string;
  kind: "sale" | "gift" | "inheritance" | "court_order";
  status: RequestStatus;
  declared_value: number | null;
  from_owners: OwnerEntry[];
  to_owners: OwnerEntry[];
  created_at: string;
  created_by: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  note: string | null;
  parcel: { id: string; pun: string | null } | null;
  /** The transfer type chosen (Valuation → Transfer types); older transfers may have none. */
  type: { name_so: string; name_en: string } | null;
  duty_invoice: { id: string; number: string; status: string; balance: number; total: number } | null;
}

const TRANSFER_COLS =
  "id, number, kind, status, declared_value, from_owners, to_owners, created_at, created_by, submitted_at, decided_at, decision_note, note, parcel:parcels(id, pun), type:transfer_types(name_so, name_en), duty_invoice:invoices!transfers_duty_invoice_id_fkey(id, number, status, balance, total)";

export async function listTransfers(status: RequestStatus | "open" | "any", parcelId?: string) {
  const supabase = await createClient();
  let req = supabase.from("transfers").select(TRANSFER_COLS);
  if (status === "open") req = req.in("status", ["draft", "submitted"]);
  else if (status !== "any") req = req.eq("status", status);
  if (parcelId) req = req.eq("parcel_id", parcelId);
  return unwrap(await req.order("created_at", { ascending: false }).limit(100), "transfers") as unknown as TransferRow[];
}

export async function getTransfer(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  return unwrap(await supabase.from("transfers").select(TRANSFER_COLS).eq("id", id).maybeSingle(), "transfer") as unknown as TransferRow | null;
}

export interface ParcelLegal {
  blockers: { transfer: string[]; subdivide: string[]; permit: string[] };
  leases: { id: string; number: string; start_date: string; end_date: string; annual_rent: number; purpose: string | null; status: string; lessee: { full_name: string } | null }[];
  changes: { id: string; number: string; kind: string; status: string; reason: string; requested_by: string | null; requested_at: string; result_parcel_ids: string[] }[];
  transfers: TransferRow[];
  /** The transfer types staff can choose from (switched-on ones). */
  transferTypes: TransferTypeChoice[];
}

export interface TransferTypeChoice {
  id: string;
  name_so: string;
  name_en: string;
  works_as: TransferRow["kind"];
  duty: number;
}

export async function parcelLegal(parcelId: string): Promise<ParcelLegal> {
  const supabase = await createClient();
  const [s, le, c, t, ty] = await Promise.all([
    supabase.rpc("parcel_legal_status", { p_parcel: parcelId }),
    supabase.from("leases").select("id, number, start_date, end_date, annual_rent, purpose, status, lessee:parties(full_name)").eq("parcel_id", parcelId).order("start_date", { ascending: false }),
    supabase.from("parcel_changes").select("id, number, kind, status, reason, requested_by, requested_at, result_parcel_ids").contains("parcel_ids", [parcelId]).order("requested_at", { ascending: false }),
    listTransfers("any", parcelId),
    supabase.from("transfer_types").select("id, name_so, name_en, works_as, duty").eq("active", true).order("sort").order("name_en"),
  ]);
  return {
    blockers: (s.data as ParcelLegal["blockers"] | null) ?? { transfer: [], subdivide: [], permit: [] },
    leases: (le.data ?? []) as unknown as ParcelLegal["leases"],
    changes: (c.data ?? []) as ParcelLegal["changes"],
    transfers: t,
    transferTypes: (ty.data ?? []) as TransferTypeChoice[],
  };
}

/** Parcel changes, newest first; with a parcel, only those it was part of or came out of. */
export async function listChanges(status: "submitted" | "any", parcelId?: string) {
  const supabase = await createClient();
  let req = supabase.from("parcel_changes").select("id, number, kind, status, reason, payload, parcel_ids, requested_by, requested_at, decided_at, result_parcel_ids");
  if (status === "submitted") req = req.eq("status", "submitted");
  if (parcelId) req = req.or(`parcel_ids.cs.{${parcelId}},result_parcel_ids.cs.{${parcelId}}`);
  const rows = unwrap(await req.order("requested_at", { ascending: false }).limit(100), "changes") as { id: string; number: string; kind: string; status: string; reason: string; payload: { land_use?: string; children?: unknown[] } & Record<string, unknown>; parcel_ids: string[]; requested_by: string | null; requested_at: string; decided_at: string | null; result_parcel_ids: string[] }[];
  const ids = [...new Set(rows.flatMap((r) => [...r.parcel_ids, ...r.result_parcel_ids]))];
  const { data } = ids.length ? await supabase.from("parcels").select("id, pun").in("id", ids) : { data: [] };
  const pun = new Map(((data ?? []) as { id: string; pun: string | null }[]).map((p) => [p.id, p.pun]));
  return rows.map((r) => ({ ...r, puns: r.parcel_ids.map((i) => pun.get(i) ?? "?"), result_puns: r.result_parcel_ids.map((i) => pun.get(i) ?? "?") }));
}

export interface PermitRow {
  id: string;
  number: string;
  kind: string;
  status: RequestStatus;
  description: string;
  floors: number | null;
  area_m2: number | null;
  applicant_name: string;
  conditions: string | null;
  valid_until: string | null;
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
  parcel: { id: string; pun: string | null } | null;
  fee_invoice: { id: string; number: string; status: string } | null;
}

export async function legalCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("legal_counts");
  return (data ?? {}) as Record<"transfers_waiting" | "transfers_draft" | "disputes_open" | "liens_active" | "orders_active" | "changes_waiting" | "permits_waiting" | "leases_active", number>;
}
